"""
結構化錯誤：{error_code, reason, hint, detail}（HTTP 狀態維持 4xx/5xx）。

前端（src/lib/ocr-diagnostics.ts）依 error_code 顯示原因與是否可用「修復模式」。
"""
from __future__ import annotations

import re

import httpx
from fastapi.responses import JSONResponse


class StructuredError(Exception):
    def __init__(self, status: int, error_code: str, reason: str, hint: str = "", detail: str = ""):
        super().__init__(reason)
        self.status = status
        self.error_code = error_code
        self.reason = reason
        self.hint = hint
        self.detail = detail or reason

    def body(self) -> dict:
        return {"error_code": self.error_code, "reason": self.reason, "hint": self.hint, "detail": self.detail}

    def response(self) -> JSONResponse:
        return JSONResponse(status_code=self.status, content=self.body())


def precheck_index_text(text) -> StructuredError | None:
    """入庫前檢查（不呼叫 embedding，避免白白耗費平台額度）。"""
    if not isinstance(text, str) or not text.strip():
        return StructuredError(
            422, "empty_text", "沒有可入庫的文字（檔案可能是掃描檔或文字層為空）",
            "請以修復模式（repair=true）重新提取，掃描檔會改用 OCR 辨識",
        )
    if "\x00" in text:
        n = text.count("\x00")
        return StructuredError(
            422, "nul_in_text", f"文字含 {n} 個空字元（\\x00），PostgreSQL 無法寫入",
            "請使用修復模式（repair=true）重新提取：會移除空字元、Unicode 正規化，必要時改用 OCR",
            f"nul_chars={n}",
        )
    return None


_STATUS_RE = re.compile(r"HTTP (\d{3})")


def _status_of(exc: Exception) -> int | None:
    sc = getattr(exc, "status_code", None)
    if isinstance(sc, int):
        return sc
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code
    m = _STATUS_RE.search(str(exc))
    return int(m.group(1)) if m else None


def classify_embedding_error(exc: Exception) -> StructuredError:
    sc = _status_of(exc)
    hint = "AI 平台暫時無法計算向量，請稍後再試"
    if sc in (401, 403):
        hint = "AI 平台拒絕授權，請確認 API 金鑰"
    elif sc == 429:
        hint = "AI 平台額度或頻率限制，請稍後再試"
    elif sc == 413 or (sc == 400 and "token" in str(exc).lower()):
        hint = "送出的文字過長，請調低 EMBED_MAX_CHARS"
    elif isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
        hint = "連線 AI 平台逾時或中斷，請確認網路後再試"
    reason = "向量計算失敗" + (f"（平台 HTTP {sc}）" if sc else f"（{type(exc).__name__}）")
    return StructuredError(502, "embedding_failed", reason, hint, str(exc)[:1000])


def classify_db_error(exc: Exception) -> StructuredError:
    msg = str(exc)
    low = msg.lower()
    if "0x00" in low or "\\x00" in msg or "null character" in low or "invalid byte sequence" in low:
        return StructuredError(
            422, "nul_in_text", "文字含空字元或無效位元組，PostgreSQL 無法寫入",
            "請使用修復模式（repair=true）重新提取", msg[:1000],
        )
    return StructuredError(500, "db_error", "資料庫寫入失敗", "請確認資料庫服務正常後再試", msg[:1000])
