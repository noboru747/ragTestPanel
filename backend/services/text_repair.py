"""
文字提取的診斷與修復（純函式，無 I/O，方便單元測試）。

- sanitize()        移除 \\x00 與其他不可見控制字元（保留 \\n \\t）、Unicode NFKC 正規化
                    （康熙部首 ⼿⼯⾃ → 手工自），tesseract 中文字間空白收斂另由 tidy_ocr_text() 處理
- diagnose()        計算 nul_chars / radical_chars / text_chars / pages / chars_per_page / suspected
- needs_pdf_ocr()   判斷 PDF 是否應改走「渲染成圖片再 OCR」
- decode_text_bytes() .txt 編碼自動偵測（BOM → UTF-16 啟發式 → UTF-8 → Big5/CP950）
"""
from __future__ import annotations

import os
import re
import unicodedata

# ── 可調參數（環境變數覆寫）──────────────────────────────────────────────
# 每頁平均有效字數低於此值 → 視為掃描檔
PDF_MIN_CHARS_PER_PAGE = int(os.getenv("PDF_MIN_CHARS_PER_PAGE", "30"))
# \x00 佔（\x00 + 有效字）比例高於此值 → 視為文字層損壞、改用 OCR
PDF_NUL_RATIO_OCR = float(os.getenv("PDF_NUL_RATIO_OCR", "0.10"))
# 康熙部首 / 部首補充 字元比例高於此值（且至少 RADICAL_MIN 個）→ 文字層可疑
RADICAL_RATIO = float(os.getenv("PDF_RADICAL_RATIO", "0.005"))
RADICAL_MIN = 3
# OCR 渲染設定
PDF_OCR_MAX_PAGES = int(os.getenv("PDF_OCR_MAX_PAGES", "30"))
PDF_OCR_DPI = int(os.getenv("PDF_OCR_DPI", "200"))
# 實測（200 DPI，掃描合約與請款表格）：chi_tra 單獨比 chi_tra+eng 快約 25%，
# 表格頁中文字辨識較多、雜訊符號較少（+eng 會把模糊中文誤判成拉丁字母）
PDF_OCR_LANG = os.getenv("PDF_OCR_LANG", "chi_tra")

# 要移除的不可見字元：C0/C1 控制字元（\t \n \r 除外，\r 另行換成 \n）、
# 零寬字元、BOM、軟連字號、方向控制符
_INVISIBLE_RE = re.compile(
    "[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f­​-‏‪-‮⁠-⁤﻿]"
)
_RADICAL_RE = re.compile("[⺀-⻿⼀-⿟]")
_CJK = "㐀-䶿一-鿿豈-﫿　-〿＀-￯"
_CJK_SPACE_RE = re.compile(f"(?<=[{_CJK}])[ 　]+(?=[{_CJK}])")


def count_text_chars(text: str) -> int:
    """有效字數：排除空白與所有控制 / 格式字元（含 \\x00）。"""
    n = 0
    for ch in text:
        if ch.isspace():
            continue
        cat = unicodedata.category(ch)
        if cat in ("Cc", "Cf"):
            continue
        n += 1
    return n


def sanitize(text: str) -> tuple[str, list[str]]:
    """回傳 (清理後文字, 實際套用的修復項目)。項目：strip_nul / strip_control / nfkc。"""
    applied: list[str] = []
    if not text:
        return text or "", applied
    if "\x00" in text:
        text = text.replace("\x00", "")
        applied.append("strip_nul")
    t2 = text.replace("\r\n", "\n").replace("\r", "\n")
    t2 = _INVISIBLE_RE.sub("", t2)
    if t2 != text:
        applied.append("strip_control")
    text = t2
    t3 = unicodedata.normalize("NFKC", text)
    if t3 != text:
        applied.append("nfkc")
    return t3, applied


def tidy_ocr_text(text: str) -> str:
    """tesseract 中文輸出常在每個字之間插空白 → 收斂；並壓掉過多空行。"""
    text = _CJK_SPACE_RE.sub("", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def diagnose(text: str, pages: int | None = None) -> dict:
    """
    根據原始提取文字判斷狀況：
      text_layer_broken：含 \\x00，或康熙部首字元比例異常（PDF 字型缺 ToUnicode 對應）
      scanned_pdf      ：PDF 每頁平均有效字數 < PDF_MIN_CHARS_PER_PAGE
    """
    text = text or ""
    nul = text.count("\x00")
    radicals = len(_RADICAL_RE.findall(text))
    tc = count_text_chars(text)
    d: dict = {"nul_chars": nul, "radical_chars": radicals, "text_chars": tc}
    suspected = None
    if nul > 0:
        suspected = "text_layer_broken"
    elif radicals >= RADICAL_MIN and radicals / max(tc, 1) >= RADICAL_RATIO:
        suspected = "text_layer_broken"
    if pages is not None:
        d["pages"] = pages
        cpp = round(tc / pages, 1) if pages else 0.0
        d["chars_per_page"] = cpp
        if suspected is None and cpp < PDF_MIN_CHARS_PER_PAGE:
            suspected = "scanned_pdf"
    d["suspected"] = suspected
    return d


def nul_ratio(diag: dict) -> float:
    nul = diag.get("nul_chars", 0)
    return nul / max(nul + diag.get("text_chars", 0), 1)


def needs_pdf_ocr(diag: dict) -> bool:
    """PDF 是否要改走渲染 + OCR：每頁有效字數過少，或 \\x00 比例過高。"""
    if diag.get("pages") and diag.get("chars_per_page", 0) < PDF_MIN_CHARS_PER_PAGE:
        return True
    return nul_ratio(diag) > PDF_NUL_RATIO_OCR


# ── .txt 編碼偵測 ────────────────────────────────────────────────────────
def decode_text_bytes(data: bytes) -> tuple[str, str]:
    """回傳 (文字, 編碼名稱)。順序：BOM → UTF-16 無 BOM 啟發式 → UTF-8 → CP950(Big5) → Big5-HKSCS → UTF-8(replace)。"""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace"), "utf-8-sig"
    if data.startswith(b"\xff\xfe"):
        return data[2:].decode("utf-16-le", errors="replace"), "utf-16-le"
    if data.startswith(b"\xfe\xff"):
        return data[2:].decode("utf-16-be", errors="replace"), "utf-16-be"
    if len(data) >= 4:
        sample = data[:4000]
        even0 = sample[0::2].count(0)
        odd0 = sample[1::2].count(0)
        half = len(sample) / 2
        # ASCII 為主的 UTF-16：其中一側大量 0；中文為主的 UTF-16 用 strict 解碼驗證
        if odd0 > half * 0.3 and even0 < half * 0.05:
            try:
                return data.decode("utf-16-le"), "utf-16-le"
            except UnicodeDecodeError:
                pass
        if even0 > half * 0.3 and odd0 < half * 0.05:
            try:
                return data.decode("utf-16-be"), "utf-16-be"
            except UnicodeDecodeError:
                pass
    for enc in ("utf-8", "cp950", "big5hkscs"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replace"
