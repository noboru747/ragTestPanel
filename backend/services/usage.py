"""
LLM / embedding / vision 用量記錄（llm_usage 表）。

- project_id 由路由以 contextvars 設定：set_usage_project(pid)
- record_usage(...) 以背景 task 寫入，任何錯誤都吞掉（不得影響主流程）
- 腳本結束前呼叫 await flush_usage() 等背景寫入完成
- 回應沒有 usage 時以字數估算（estimate_tokens），estimated=TRUE
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import re

logger = logging.getLogger(__name__)

_current_project: contextvars.ContextVar[str | None] = contextvars.ContextVar("usage_project_id", default=None)
_pending: set[asyncio.Task] = set()

_CJK_RE = re.compile(r"[　-〿㐀-䶿一-鿿豈-﫿＀-￯]")


def set_usage_project(project_id: str | None) -> None:
    _current_project.set((project_id or "").strip() or None)


def current_project() -> str | None:
    return _current_project.get()


def estimate_tokens(text: str) -> int:
    """粗估 token：中日韓字元約 0.79 token/字（bge-m3 實測），其餘非空白字元約 4 字 1 token。"""
    if not text:
        return 0
    cjk = len(_CJK_RE.findall(text))
    other = len(re.sub(r"\s+", "", text)) - cjk
    return int(round(cjk * 0.79 + other / 4)) + (1 if text.strip() else 0)


def usage_from_openai(data: dict | None) -> tuple[int, int, int] | None:
    """OpenAI 相容回應的 usage → (prompt, completion, total)；沒有 usage 回傳 None。"""
    u = (data or {}).get("usage") if isinstance(data, dict) else None
    if not isinstance(u, dict):
        return None
    p = int(u.get("prompt_tokens") or 0)
    c = int(u.get("completion_tokens") or 0)
    t = int(u.get("total_tokens") or (p + c))
    if not (p or c or t):
        return None
    return p, c, t


def usage_from_ollama(data: dict | None) -> tuple[int, int, int] | None:
    if not isinstance(data, dict):
        return None
    p = int(data.get("prompt_eval_count") or 0)
    c = int(data.get("eval_count") or 0)
    if not (p or c):
        return None
    return p, c, p + c


def build_record(*, provider: str, model: str | None, operation: str, endpoint: str,
                 usage: tuple[int, int, int] | None, prompt_text: str = "", completion_text: str = "",
                 latency_ms: float | None = None, success: bool = True, error_code: str | None = None,
                 request_id: str | None = None, project_id: str | None = None) -> dict:
    estimated = False
    if usage is None:
        p, c = estimate_tokens(prompt_text), estimate_tokens(completion_text)
        usage = (p, c, p + c)
        estimated = True
    return {
        "provider": provider, "model": model, "operation": operation, "endpoint": endpoint,
        "project_id": project_id if project_id is not None else current_project(),
        "prompt_tokens": usage[0], "completion_tokens": usage[1], "total_tokens": usage[2],
        "latency_ms": int(latency_ms) if latency_ms is not None else None,
        "success": success, "error_code": error_code, "request_id": request_id, "estimated": estimated,
    }


async def _write(rec: dict) -> None:
    try:
        from sqlalchemy import text
        from services.db_service import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await db.execute(text("""
                INSERT INTO llm_usage (provider, model, operation, endpoint, project_id, prompt_tokens,
                    completion_tokens, total_tokens, latency_ms, success, error_code, request_id, estimated)
                VALUES (:provider, :model, :operation, :endpoint, :project_id, :prompt_tokens,
                    :completion_tokens, :total_tokens, :latency_ms, :success, :error_code, :request_id, :estimated)
            """), rec)
            await db.commit()
    except Exception as exc:  # noqa: BLE001 — 記錄失敗不得影響主流程
        logger.warning("llm_usage 寫入失敗：%s", exc)


def record_usage(**kwargs) -> None:
    try:
        rec = build_record(**kwargs)
        task = asyncio.get_running_loop().create_task(_write(rec))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_usage 記錄失敗：%s", exc)


async def flush_usage() -> None:
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)
