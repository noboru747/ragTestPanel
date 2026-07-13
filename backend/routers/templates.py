"""
文件模板管理：CRUD 操作，資料儲存於 PostgreSQL document_templates 表
內建模板（built-in）從 backend/templates/*.json 讀取，優先於 DB 顯示
"""
import json
import os
import re
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.db_service import get_db

router = APIRouter()

# ── Built-in JSON template helpers ─────────────────────────────────────────────

_TMPL_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "templates"))
_SAFE_ID = re.compile(r'^[\w\-]+$')  # alphanumeric, dash, underscore only


def _load_builtin_templates() -> list[dict]:
    """掃描 backend/templates/*.json，回傳所有內建模板清單"""
    templates = []
    if not os.path.isdir(_TMPL_DIR):
        return templates
    for fname in sorted(os.listdir(_TMPL_DIR)):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(_TMPL_DIR, fname)
        try:
            with open(fpath, encoding="utf-8") as f:
                data = json.load(f)
            templates.append(data)
        except (json.JSONDecodeError, OSError):
            pass
    return templates


def _load_builtin_by_id(template_id: str) -> dict | None:
    """根據 ID 讀取單一內建模板；ID 不合法或找不到時回傳 None"""
    if not _SAFE_ID.match(template_id):
        return None
    fpath = os.path.join(_TMPL_DIR, f"{template_id}.json")
    if not os.path.isfile(fpath):
        return None
    try:
        with open(fpath, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _gen_id() -> str:
    return f"tmpl-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6]}"


def _row_to_dict(row) -> dict:
    return {
        "id":         row.id,
        "name":       row.name,
        "fields":     row.fields,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── LIST ───────────────────────────────────────────────────────────────────────

@router.get("")
async def list_templates(db: AsyncSession = Depends(get_db)):
    # 內建 JSON 模板（built-in，優先置頂）
    builtin = _load_builtin_templates()
    builtin_ids = {t["id"] for t in builtin}

    # DB 使用者自建模板（排除與內建同 ID 的，避免重複）
    result = await db.execute(
        text("SELECT id, name, fields, created_at, updated_at FROM document_templates ORDER BY created_at DESC")
    )
    db_rows = [_row_to_dict(r) for r in result.fetchall() if r.id not in builtin_ids]

    return {"templates": [*builtin, *db_rows]}


# ── CREATE ─────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_template(payload: dict, db: AsyncSession = Depends(get_db)):
    name = payload.get("name")
    if not name:
        raise HTTPException(400, "name 為必填欄位")
    fields = payload.get("fields", [])

    tmpl_id = _gen_id()
    await db.execute(
        text("""
            INSERT INTO document_templates (id, name, fields, created_at, updated_at)
            VALUES (:id, :name, CAST(:fields AS jsonb), NOW(), NOW())
        """),
        {"id": tmpl_id, "name": name, "fields": __import__("json").dumps(fields, ensure_ascii=False)},
    )
    await db.commit()

    result = await db.execute(
        text("SELECT id, name, fields, created_at, updated_at FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    row = result.fetchone()
    return _row_to_dict(row)


# ── GET ONE ────────────────────────────────────────────────────────────────────

@router.get("/{tmpl_id}")
async def get_template(tmpl_id: str, db: AsyncSession = Depends(get_db)):
    # 先查內建 JSON 模板
    builtin = _load_builtin_by_id(tmpl_id)
    if builtin:
        return builtin

    # 再查 DB
    result = await db.execute(
        text("SELECT id, name, fields, created_at, updated_at FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "模板不存在")
    return _row_to_dict(row)


# ── UPDATE ─────────────────────────────────────────────────────────────────────

@router.put("/{tmpl_id}")
async def update_template(tmpl_id: str, payload: dict, db: AsyncSession = Depends(get_db)):
    # 先確認存在
    check = await db.execute(
        text("SELECT id FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    if not check.fetchone():
        raise HTTPException(404, "模板不存在")

    updates = []
    params: dict = {"id": tmpl_id}

    if "name" in payload:
        updates.append("name = :name")
        params["name"] = payload["name"]
    if "fields" in payload:
        updates.append("fields = CAST(:fields AS jsonb)")
        params["fields"] = __import__("json").dumps(payload["fields"], ensure_ascii=False)

    if not updates:
        raise HTTPException(400, "沒有可更新的欄位（name 或 fields）")

    updates.append("updated_at = NOW()")
    await db.execute(
        text(f"UPDATE document_templates SET {', '.join(updates)} WHERE id = :id"),
        params,
    )
    await db.commit()

    result = await db.execute(
        text("SELECT id, name, fields, created_at, updated_at FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    return _row_to_dict(result.fetchone())


# ── DELETE ─────────────────────────────────────────────────────────────────────

@router.delete("/{tmpl_id}")
async def delete_template(tmpl_id: str, db: AsyncSession = Depends(get_db)):
    check = await db.execute(
        text("SELECT id FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    if not check.fetchone():
        raise HTTPException(404, "模板不存在")

    await db.execute(
        text("DELETE FROM document_templates WHERE id = :id"),
        {"id": tmpl_id},
    )
    await db.commit()
    return {"ok": True}
