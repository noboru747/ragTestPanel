import asyncio
import base64
import os
import logging
import tempfile
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from services.db_service import AsyncSessionLocal
from services.mask_store import load_mappings, lock_project, upsert_mappings
from services.masking import mask_text
from services.ollama_service import ollama

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
    }.get(ext, "")


@router.post("/extract")
async def extract_text(
    file: UploadFile = File(...),
    mask: str = Form("false"),
    project_id: str = Form(""),
):
    """
    mask="true"：敏感資料遮罩模式
      - 圖片一律用本機 tesseract（不呼叫 vision_ocr，避免原圖送外部平台），method="tesseract_local"
      - 提取文字經 services.masking.mask_text 遮罩後回傳（text 為遮罩後文字）
      - 回應另含 masked / mask_summary / mask_total / mask_ms / mask_scope
      - 有 project_id → 沿用該專案 mask_mappings 代號、新值接續編號並寫回表（mask_scope="project"）
      - 無 project_id → 文件內編號、不寫表（mask_scope="document"）
    mask="false"（預設）：維持原行為，回應含 masked=false
    """
    do_mask = str(mask).strip().lower() in ("true", "1", "yes", "on")
    content = await file.read()
    fname = file.filename or ""
    text, method = await _extract(content, fname, file.content_type or "", local_only=do_mask)

    result: dict = {"filename": fname, "text": text, "method": method, "masked": do_mask}
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


async def _extract(content: bytes, fname: str, content_type: str, local_only: bool) -> tuple[str, str]:
    # browsers sometimes send application/octet-stream — fall back to extension
    if not content_type or content_type == "application/octet-stream":
        content_type = _guess_type_by_ext(fname)

    if content_type in SUPPORTED_IMAGE_TYPES:
        if local_only:
            # 遮罩模式：原圖不可離開本機 → 只用 tesseract
            try:
                return await asyncio.to_thread(_extract_image_tesseract, content), "tesseract_local"
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f"本機 tesseract OCR 失敗：{exc}")
        b64 = base64.b64encode(content).decode()
        try:
            return await ollama.vision_ocr(b64, filename=fname), "vision_ocr"
        except Exception as exc:
            logger.warning("vision_ocr 失敗，改用 tesseract：%s", exc)
        # fallback: tesseract OCR
        try:
            return await asyncio.to_thread(_extract_image_tesseract, content), "tesseract"
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"圖片 OCR 失敗（vision 模型未就緒，tesseract 也無法處理）。錯誤：{exc}",
            )

    if content_type == "application/pdf":
        return _extract_pdf(content), "pdf_parse"

    if "wordprocessingml" in content_type:
        return _extract_docx(content), "docx_parse"

    if content_type == "application/msword" or fname.lower().endswith(".doc"):
        return await _extract_doc(content, fname), "antiword"

    if "spreadsheetml" in content_type:
        return _extract_xlsx(content), "xlsx_parse"

    if "presentationml" in content_type:
        return _extract_pptx(content), "pptx_parse"

    raise HTTPException(status_code=415, detail=f"不支援的檔案類型：{content_type or fname}")


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(content: bytes) -> str:
    from docx import Document
    import io
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
    import io
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    lines = []
    for sheet in wb.worksheets:
        lines.append(f"=== {sheet.title} ===")
        for row in sheet.iter_rows(values_only=True):
            row_str = "\t".join(str(c) if c is not None else "" for c in row)
            if row_str.strip():
                lines.append(row_str)
    return "\n".join(lines)


def _extract_pptx(content: bytes) -> str:
    from pptx import Presentation
    import io
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
    import io
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
            raise HTTPException(
                status_code=415,
                detail=f"無法解析 .doc 檔案（{err or '格式不支援'}）。請在 Word 中另存為 .docx 後重新上傳。",
            )
        return stdout.decode(errors="replace")
    finally:
        os.unlink(tmp.name)
