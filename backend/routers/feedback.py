import json
import os
import random
import string
import uuid
from datetime import datetime

from fastapi import APIRouter

router = APIRouter()

FEEDBACK_FILE = os.path.join(os.path.dirname(__file__), "..", "feedback", "feedback.json")


def _gen_code() -> str:
    """6 碼大寫英數短碼，供人工快速引用"""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _load() -> list:
    try:
        with open(FEEDBACK_FILE, encoding="utf-8") as f:
            entries = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

    # 回填：舊資料若沒有 code 欄位，補上並存回去
    patched = False
    for e in entries:
        if not e.get("code"):
            e["code"] = _gen_code()
            patched = True
    if patched:
        _save(entries)

    return entries


def _save(entries: list):
    os.makedirs(os.path.dirname(FEEDBACK_FILE), exist_ok=True)
    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


@router.post("")
async def submit_feedback(payload: dict):
    page    = payload.get("page", "").strip()
    topic   = payload.get("topic", "").strip()
    content = payload.get("content", "").strip()

    if not topic or not content:
        return {"ok": False, "error": "topic and content required"}

    entry = {
        "id":          str(uuid.uuid4()),
        "code":        _gen_code(),
        "page":        page,
        "topic":       topic,
        "content":     content,
        "submittedAt": datetime.utcnow().isoformat() + "Z",
    }

    entries = _load()
    entries.insert(0, entry)
    entries = entries[:500]
    _save(entries)

    return {"ok": True, "id": entry["id"], "code": entry["code"]}


@router.get("")
async def list_feedback():
    return {"feedback": _load()}


@router.delete("/{feedback_id}")
async def delete_feedback(feedback_id: str):
    entries = [e for e in _load() if e["id"] != feedback_id]
    _save(entries)
    return {"ok": True}
