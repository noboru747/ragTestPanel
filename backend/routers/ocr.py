import asyncio
import base64
import io
import os
import logging
import tempfile
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, UploadFile, File, Form
from services.db_service import AsyncSessionLocal
from services.doc_errors import StructuredError
from services.mask_store import load_mappings, lock_project, upsert_mappings
from services.masking import mask_text
from services.ollama_service import ollama
from services.usage import set_usage_project
from services.text_repair import (
    PDF_OCR_DPI, PDF_OCR_LANG, PDF_OCR_MAX_PAGES,
    count_text_chars, decode_text_bytes, diagnose, needs_pdf_ocr, sanitize, tidy_ocr_text,
)

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _guess_type_by_ext(filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls":  "application/vnd.ms-excel",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ppt":  "application/vnd.ms-powerpoint",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "png":  "image/png",
        "webp": "image/webp",
        "gif":  "image/gif",
        "txt":  "text/plain",
    }.get(ext, "")


@router.post("/extract")
async def extract_text(
    file: UploadFile = File(...),
    mask: str = Form("false"),
    project_id: str = Form(""),
    repair: str = Form("false"),
):
    """
    mask="true"：敏感資料遮罩模式
      - 圖片一律用本機 tesseract（不呼叫 vision_ocr，避免原圖送外部平台），method="tesseract_local"
      - 提取文字經 services.masking.mask_text 遮罩後回傳（text 為遮罩後文字）
      - 回應另含 masked / mask_summary / mask_total / mask_ms / mask_scope
      - 有 project_id → 沿用該專案 mask_mappings 代號、新值接續編號並寫回表（mask_scope="project"）
      - 無 project_id → 文件內編號、不寫表（mask_scope="document"）
    mask="false"（預設）：維持原行為，回應含 masked=false

    repair="true"：修復模式
      - 文字清理：移除 \\x00 / 不可見控制字元（保留 \\n \\t）、Unicode NFKC 正規化（康熙部首 → 一般字）
      - PDF 每頁有效字數過少或 \\x00 比例過高 → 渲染成圖片再 OCR
        （mask=true → 本機 tesseract，method="pdf_ocr_tesseract"；mask=false → 平台 vision，method="pdf_ocr_vision"）
      - 回應含 repaired / repairs_applied（strip_nul / strip_control / nfkc / pdf_ocr）
    repair="false"（預設）：文字原樣回傳（含 \\x00 也照樣回傳，入庫時會以 nul_in_text 失敗，保留狀況）

    無論 repair 與否，回應都含 diagnostics（依原始提取文字計算）：
      {nul_chars, radical_chars, text_chars, pages?, chars_per_page?, suspected}
    失敗時回 {error_code, reason, hint, detail}。
    """
    do_mask = _truthy(mask)
    do_repair = _truthy(repair)
    set_usage_project(project_id)
    content = await file.read()
    fname = file.filename or ""
    try:
        ex = await _extract(content, fname, file.content_type or "", local_only=do_mask)
        diag = diagnose(ex.text, ex.pages)
        diag.update(ex.extra)
        text, method = ex.text, ex.method
        repairs: list[str] = []
        if do_repair:
            text, method, repairs = await _repair(content, fname, ex, diag, local_only=do_mask)
    except StructuredError as e:
        return e.response()

    result: dict = {"filename": fname, "text": text, "method": method, "masked": do_mask, "diagnostics": diag}
    if do_repair:
        result["repaired"] = bool(repairs)
        result["repairs_applied"] = repairs
        diag["text_chars_after"] = count_text_chars(text)
    if do_mask:
        pid = (project_id or "").strip()
        if pid:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    await lock_project(db, pid)
                    existing = await load_mappings(db, pid)
                    t0 = time.perf_counter()
                    masked, summary, used = mask_text(text or "", existing=existing, with_mappings=True)
                    mask_ms = (time.perf_counter() - t0) * 1000
                    await upsert_mappings(db, pid, used, fname)
            result["mask_scope"] = "project"
        else:
            t0 = time.perf_counter()
            masked, summary = mask_text(text or "")
            mask_ms = (time.perf_counter() - t0) * 1000
            result["mask_scope"] = "document"
        result["text"] = masked
        result["mask_summary"] = summary
        result["mask_total"] = sum(summary.values())
        result["mask_ms"] = round(mask_ms, 2)
    return result


def _truthy(v) -> bool:
    return str(v).strip().lower() in ("true", "1", "yes", "on")


@dataclass
class Extraction:
    text: str
    method: str
    pages: int | None = None                      # 只有 PDF 有
    extra: dict = field(default_factory=dict)     # 併入 diagnostics 的額外資訊（例如 txt 的 encoding）


async def _repair(content: bytes, fname: str, ex: Extraction, diag: dict, local_only: bool) -> tuple[str, str, list[str]]:
    text, method = ex.text, ex.method
    ocr_used = False
    if ex.pages is not None and needs_pdf_ocr(diag):
        ocr_text, ocr_method, info = await _pdf_ocr(content, fname, ex.pages, local_only)
        diag.update(info)
        if count_text_chars(ocr_text) > 0:
            text, method, ocr_used = ocr_text, ocr_method, True
        else:
            diag["ocr_note"] = "OCR 沒有辨識出文字，保留原文字層"
    text, applied = sanitize(text)
    return text, method, applied + (["pdf_ocr"] if ocr_used else [])


async def _pdf_ocr(content: bytes, fname: str, total_pages: int, local_only: bool) -> tuple[str, str, dict]:
    n = min(total_pages, PDF_OCR_MAX_PAGES)
    info: dict = {"ocr_pages": n, "ocr_dpi": PDF_OCR_DPI}
    if total_pages > n:
        info["ocr_page_limit_hit"] = True
        info["ocr_note"] = f"PDF 共 {total_pages} 頁，只 OCR 前 {n} 頁（上限 PDF_OCR_MAX_PAGES={PDF_OCR_MAX_PAGES}）"
    try:
        if local_only:
            # 遮罩模式：頁面影像不可離開本機 → 只用 tesseract
            info["ocr_engine"] = f"tesseract:{PDF_OCR_LANG}"
            text = await asyncio.to_thread(_pdf_ocr_tesseract_sync, content, n)
            return text, "pdf_ocr_tesseract", info
        images = await asyncio.to_thread(_render_pdf_pages_png, content, n)
    except Exception as exc:
        raise StructuredError(503, "ocr_failed", f"PDF 渲染 / OCR 失敗：{exc}", "請確認檔案未加密、未損毀") from exc

    info["ocr_engine"] = "vision"
    parts: list[str] = []
    fallback_pages = 0
    for i, png in enumerate(images, 1):   # 依序一頁一頁送，不併發
        try:
            parts.append(await ollama.vision_ocr(base64.b64encode(png).decode(), filename=f"{fname}_p{i}.png"))
        except Exception as exc:
            logger.warning("vision_ocr 第 %d 頁失敗，改用 tesseract：%s", i, exc)
            fallback_pages += 1
            parts.append(await asyncio.to_thread(_ocr_png_tesseract, png))
    if fallback_pages:
        info["ocr_tesseract_fallback_pages"] = fallback_pages
    method = "pdf_ocr_vision" if not fallback_pages else "pdf_ocr_vision+tesseract"
    return "\n\n".join(p.strip() for p in parts if p and p.strip()), method, info


def _render_pages(content: bytes, n: int):
    """依序產生前 n 頁的灰階 PIL 影像（pypdfium2，Apache-2.0 / BSD-3-Clause）。"""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(content)
    try:
        for i in range(min(n, len(pdf))):
            page = pdf[i]
            try:
                bitmap = page.render(scale=PDF_OCR_DPI / 72, grayscale=True)
                yield bitmap.to_pil()   # PIL 影像與 bitmap 共用記憶體 → 用完前保留 bitmap 參照
                bitmap.close()
            finally:
                page.close()
    finally:
        pdf.close()


def _pdf_ocr_tesseract_sync(content: bytes, n: int) -> str:
    import pytesseract
    parts = [tidy_ocr_text(pytesseract.image_to_string(img, lang=PDF_OCR_LANG)) for img in _render_pages(content, n)]
    return "\n\n".join(p for p in parts if p)


def _render_pdf_pages_png(content: bytes, n: int) -> list[bytes]:
    out = []
    for img in _render_pages(content, n):
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        out.append(buf.getvalue())
    return out


def _ocr_png_tesseract(png: bytes) -> str:
    import pytesseract
    from PIL import Image
    return tidy_ocr_text(pytesseract.image_to_string(Image.open(io.BytesIO(png)), lang=PDF_OCR_LANG))


async def _extract(content: bytes, fname: str, content_type: str, local_only: bool) -> Extraction:
    # browsers sometimes send application/octet-stream — fall back to extension
    if not content_type or content_type == "application/octet-stream":
        content_type = _guess_type_by_ext(fname)
    low = fname.lower()

    if content_type in SUPPORTED_IMAGE_TYPES:
        if local_only:
            # 遮罩模式：原圖不可離開本機 → 只用 tesseract
            try:
                return Extraction(await asyncio.to_thread(_extract_image_tesseract, content), "tesseract_local")
            except Exception as exc:
                raise StructuredError(503, "ocr_failed", f"本機 tesseract OCR 失敗：{exc}", "請確認圖片格式正確")
        b64 = base64.b64encode(content).decode()
        try:
            return Extraction(await ollama.vision_ocr(b64, filename=fname), "vision_ocr")
        except Exception as exc:
            logger.warning("vision_ocr 失敗，改用 tesseract：%s", exc)
        # fallback: tesseract OCR
        try:
            return Extraction(await asyncio.to_thread(_extract_image_tesseract, content), "tesseract")
        except Exception as exc:
            raise StructuredError(
                503, "ocr_failed",
                f"圖片 OCR 失敗（vision 模型未就緒，tesseract 也無法處理）。錯誤：{exc}",
                "請稍後再試，或改用遮罩模式（本機 tesseract）",
            )

    try:
        if content_type == "application/pdf":
            text, pages = _extract_pdf(content)
            return Extraction(text, "pdf_parse", pages=pages)

        if "wordprocessingml" in content_type:
            return Extraction(_extract_docx(content), "docx_parse")

        if content_type == "application/msword" or low.endswith(".doc"):
            return Extraction(await _extract_doc(content, fname), "antiword")

        if "spreadsheetml" in content_type:
            return Extraction(_extract_xlsx(content), "xlsx_parse")

        if content_type == "application/vnd.ms-excel" or low.endswith(".xls"):
            return Extraction(_extract_xls(content), "xls_parse")

        if "presentationml" in content_type:
            return Extraction(_extract_pptx(content), "pptx_parse")

        if content_type.startswith("text/plain") or low.endswith(".txt"):
            text, enc = decode_text_bytes(content)
            return Extraction(text, "txt_parse", extra={"encoding": enc})
    except StructuredError:
        raise
    except Exception as exc:
        logger.warning("解析 %s 失敗：%s", fname, exc)
        raise StructuredError(
            422, "parse_failed", f"檔案解析失敗（{type(exc).__name__}）",
            "檔案可能已損毀或加密，請以原程式另存後重新上傳", str(exc)[:1000],
        )

    raise StructuredError(
        415, "unsupported_type", f"不支援的檔案類型：{content_type or fname}",
        "支援 PDF、Word（.docx/.doc）、Excel（.xlsx/.xls）、PowerPoint（.pptx）、純文字（.txt）與圖片（jpg/png/webp/gif）",
    )


def _extract_pdf(content: bytes) -> tuple[str, int]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        reader.decrypt("")
    return "\n".join(page.extract_text() or "" for page in reader.pages), len(reader.pages)


def _extract_docx(content: bytes) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(io.BytesIO(content))
    # 依文件順序輸出段落與表格（原本只取 paragraphs，表格內容整個遺失）。
    # 表格輸出成 |a|b|c| 列，讓 RAG 看得到、遮罩的表頭欄位規則也能套用。
    lines: list[str] = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            t = Paragraph(child, doc).text
            if t:
                lines.append(t)
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                cells, prev = [], None
                for cell in row.cells:
                    if cell._tc is prev:          # 合併儲存格會重複回傳同一格
                        continue
                    prev = cell._tc
                    cells.append(" ".join(cell.text.split()))
                if any(cells):
                    lines.append("|" + "|".join(cells) + "|")
            lines.append("")
    return "\n".join(lines).strip()


def _extract_xlsx(content: bytes) -> str:
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    lines = []
    for sheet in wb.worksheets:
        lines.append(f"=== {sheet.title} ===")
        lines.extend(_table_rows_to_lines(sheet.iter_rows(values_only=True)))
    return "\n".join(lines)


def _table_rows_to_lines(rows) -> list[str]:
    """
    試算表列 → tab 分隔文字。略過全空列與全空欄、截掉每列尾端空儲存格。
    （格式化範圍延伸到 XFD 欄 / 數萬列的 xlsx 會讓舊版輸出數千萬個 tab，例如「111年工作紀錄.xlsx」）
    """
    cleaned: list[list[str]] = []
    used_cols: set[int] = set()
    for row in rows:
        cells = ["" if c is None else str(c).strip() for c in row]
        while cells and not cells[-1]:
            cells.pop()
        if not cells:
            continue
        used_cols.update(i for i, c in enumerate(cells) if c)
        cleaned.append(cells)
    if not cleaned:
        return []
    keep = sorted(used_cols)
    out = []
    for cells in cleaned:
        vals = [cells[i] if i < len(cells) else "" for i in keep]
        while vals and not vals[-1]:
            vals.pop()
        out.append("\t".join(vals))
    return out


def _extract_xls(content: bytes) -> str:
    """舊版 .xls（BIFF）— xlrd 2.x（BSD）。"""
    import datetime
    import xlrd
    wb = xlrd.open_workbook(file_contents=content)
    lines = []
    for sheet in wb.sheets():
        lines.append(f"=== {sheet.name} ===")
        rows = []
        for r in range(sheet.nrows):
            vals = []
            for cell in sheet.row(r):
                v = cell.value
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        dt = xlrd.xldate_as_datetime(v, wb.datemode)
                        v = dt.date().isoformat() if dt.time() == datetime.time(0) else dt.isoformat(sep=" ")
                    except Exception:
                        pass
                elif cell.ctype == xlrd.XL_CELL_NUMBER and float(v).is_integer():
                    v = int(v)
                elif cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    v = ""
                vals.append(str(v))
            rows.append(vals)
        lines.extend(_table_rows_to_lines(rows))
    return "\n".join(lines)


def _extract_pptx(content: bytes) -> str:
    from pptx import Presentation
    prs = Presentation(io.BytesIO(content))
    lines = []
    for i, slide in enumerate(prs.slides, 1):
        lines.append(f"=== Slide {i} ===")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in para.runs)
                    if text.strip():
                        lines.append(text)
    return "\n".join(lines)


def _extract_image_tesseract(content: bytes) -> str:
    import pytesseract
    from PIL import Image
    img = Image.open(io.BytesIO(content))
    return pytesseract.image_to_string(img, lang="chi_tra+chi_sim+eng")


async def _extract_doc(content: bytes, filename: str) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".doc", delete=False)
    try:
        tmp.write(content)
        tmp.close()
        proc = await asyncio.create_subprocess_exec(
            "antiword", tmp.name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            raise StructuredError(
                415, "unsupported_type",
                f"無法解析 .doc 檔案（{err or '格式不支援'}）",
                "請在 Word 中另存為 .docx 後重新上傳",
            )
        return stdout.decode(errors="replace")
    finally:
        os.unlink(tmp.name)
