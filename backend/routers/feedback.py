import json
import os
import uuid
from datetime import datetime

from fastapi import APIRouter

router = APIRouter()

FEEDBACK_FILE = os.path.join(os.path.dirname(__file__), "..", "feedback", "feedback.json")


def _load() -> list:
    try:
        with open(FEEDBACK_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


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
        "page":        page,
        "topic":       topic,
        "content":     content,
        "submittedAt": datetime.utcnow().isoformat() + "Z",
    }

    entries = _load()
    entries.insert(0, entry)
    entries = entries[:500]
    _save(entries)

    return {"ok": True, "id": entry["id"]}


@router.get("")
async def list_feedback():
    return {"feedback": _load()}


@router.delete("/{feedback_id}")
async def delete_feedback(feedback_id: str):
    entries = [e for e in _load() if e["id"] != feedback_id]
    _save(entries)
    return {"ok": True}
