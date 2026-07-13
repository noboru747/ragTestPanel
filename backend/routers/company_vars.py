from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
import os
from datetime import datetime

router = APIRouter()

VARS_FILE = os.path.join(os.path.dirname(__file__), "..", "company_vars", "vars.json")


class VarItem(BaseModel):
    key: str
    value: str


def _load() -> list:
    os.makedirs(os.path.dirname(VARS_FILE), exist_ok=True)
    if not os.path.exists(VARS_FILE):
        return []
    with open(VARS_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save(data: list):
    os.makedirs(os.path.dirname(VARS_FILE), exist_ok=True)
    with open(VARS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@router.get("")
async def list_vars():
    return {"vars": _load()}


@router.post("")
async def upsert_var(item: VarItem):
    data = _load()
    now = datetime.utcnow().isoformat()

    for entry in data:
        if entry["key"] == item.key:
            entry["value"] = item.value
            entry["updatedAt"] = now
            _save(data)
            return {"vars": data}

    # key 不存在 → 新增
    data.append({
        "key": item.key,
        "value": item.value,
        "updatedAt": now,
    })
    _save(data)
    return {"vars": data}


@router.delete("/{key}")
async def delete_var(key: str):
    data = _load()
    new_data = [entry for entry in data if entry["key"] != key]

    if len(new_data) == len(data):
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found")

    _save(new_data)
    return {"vars": new_data}


# ── 專案層級變數 ──────────────────────────────────────────────────────────────

PROJECT_VARS_DIR = os.path.join(os.path.dirname(__file__), "..", "company_vars", "projects")


def _project_file(project_id: str) -> str:
    os.makedirs(PROJECT_VARS_DIR, exist_ok=True)
    # 只允許字母、數字、連字號、底線，防止路徑穿越
    safe_id = "".join(c for c in project_id if c.isalnum() or c in "-_")
    return os.path.join(PROJECT_VARS_DIR, f"{safe_id}.json")


def _load_project(project_id: str) -> list:
    path = _project_file(project_id)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_project(project_id: str, data: list):
    with open(_project_file(project_id), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@router.get("/project/{project_id}")
async def list_project_vars(project_id: str):
    return {"vars": _load_project(project_id)}


@router.post("/project/{project_id}")
async def upsert_project_var(project_id: str, item: VarItem):
    data = _load_project(project_id)
    now = datetime.utcnow().isoformat()

    for entry in data:
        if entry["key"] == item.key:
            entry["value"] = item.value
            entry["updatedAt"] = now
            _save_project(project_id, data)
            return {"vars": data}

    # key 不存在 → 新增
    data.append({
        "key": item.key,
        "value": item.value,
        "updatedAt": now,
    })
    _save_project(project_id, data)
    return {"vars": data}


@router.delete("/project/{project_id}/{key}")
async def delete_project_var(project_id: str, key: str):
    data = _load_project(project_id)
    new_data = [entry for entry in data if entry["key"] != key]

    if len(new_data) == len(data):
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found in project '{project_id}'")

    _save_project(project_id, new_data)
    return {"vars": new_data}
