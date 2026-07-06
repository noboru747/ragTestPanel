"""
文件需求管理：以 .md 檔案儲存需求，支援 CRUD + 觸發生成
"""
import json
import os
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from services.db_service import get_db
from services.ollama_service import ollama
from routers.documents import _vec

router = APIRouter()

REQUESTS_DIR = os.path.join(os.path.dirname(__file__), "..", "requests")


def _ensure_dir():
    os.makedirs(REQUESTS_DIR, exist_ok=True)


def _parse_md(content: str) -> dict:
    match = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not match:
        return {"frontmatter": {}, "body": content}
    fm_raw, body = match.group(1), match.group(2)
    fm: dict = {}
    for line in fm_raw.splitlines():
        if ": " in line:
            k, v = line.split(": ", 1)
            fm[k.strip()] = v.strip()
    if "form_data" in fm:
        try:
            fm["form_data"] = json.loads(fm["form_data"])
        except Exception:
            pass
    return {"frontmatter": fm, "body": body}


def _write_md(req_id: str, meta: dict, body: str):
    _ensure_dir()
    lines = []
    for k, v in meta.items():
        if isinstance(v, (dict, list)):
            lines.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
        else:
            lines.append(f"{k}: {v}")
    content = "---\n" + "\n".join(lines) + "\n---\n" + body
    path = os.path.join(REQUESTS_DIR, f"{req_id}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _build_body(title: str, form_data: dict, project_id: str, project_name: str, template_id: str, doc_type: str) -> str:
    rows = "\n".join(
        f"| {k} | {v} |"
        for k, v in form_data.items()
        if k not in ("project_id", "_project_id") and v
    )
    return f"""
# 文件需求：{title}

## 📋 需求內容

| 欄位 | 內容 |
|------|------|
{rows}

## 🔖 生成設定

- 知識庫專案：{project_name}（{project_id}）
- 文件類型：{doc_type}
- 模板 ID：{template_id}

---

## ✅ 生成結果

（尚未生成，請至「文件生成」頁面觸發生成）
""".strip()


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_requests():
    _ensure_dir()
    items = []
    for fname in sorted(os.listdir(REQUESTS_DIR), reverse=True):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(REQUESTS_DIR, fname)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        fm = _parse_md(content)["frontmatter"]
        items.append({
            "id":           fm.get("id", fname[:-3]),
            "title":        fm.get("title", ""),
            "doc_type":     fm.get("doc_type", ""),
            "template_id":  fm.get("template_id", ""),
            "project_id":   fm.get("project_id", ""),
            "project_name": fm.get("project_name", ""),
            "status":       fm.get("status", "pending"),
            "created_at":   fm.get("created_at", ""),
            "completed_at": fm.get("completed_at", ""),
        })
    return {"requests": items}


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_request(payload: dict):
    req_id       = f"req-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    title        = payload.get("title", "未命名文件需求")
    doc_type     = payload.get("doc_type", "proposal")
    template_id  = payload.get("template_id", "")
    project_id   = payload.get("project_id", "")
    project_name = payload.get("project_name", "")
    form_data    = payload.get("form_data", {})

    meta = {
        "id":           req_id,
        "title":        title,
        "doc_type":     doc_type,
        "template_id":  template_id,
        "project_id":   project_id,
        "project_name": project_name,
        "status":       "pending",
        "created_at":   datetime.now().isoformat(timespec="seconds"),
        "form_data":    form_data,
    }
    body = _build_body(title, form_data, project_id, project_name, template_id, doc_type)
    _write_md(req_id, meta, "\n" + body + "\n")
    return {"id": req_id, "status": "pending"}


# ── GET ONE ───────────────────────────────────────────────────────────────────

@router.get("/{req_id}")
async def get_request(req_id: str):
    _ensure_dir()
    path = os.path.join(REQUESTS_DIR, f"{req_id}.md")
    if not os.path.exists(path):
        raise HTTPException(404, "需求不存在")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    parsed = _parse_md(content)
    return {"md": content, "frontmatter": parsed["frontmatter"], "body": parsed["body"]}


# ── DELETE ────────────────────────────────────────────────────────────────────

@router.delete("/{req_id}")
async def delete_request(req_id: str):
    _ensure_dir()
    path = os.path.join(REQUESTS_DIR, f"{req_id}.md")
    if not os.path.exists(path):
        raise HTTPException(404, "需求不存在")
    os.unlink(path)
    return {"ok": True}


# ── GENERATE ──────────────────────────────────────────────────────────────────

@router.post("/{req_id}/generate")
async def generate_for_request(req_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import text

    _ensure_dir()
    path = os.path.join(REQUESTS_DIR, f"{req_id}.md")
    if not os.path.exists(path):
        raise HTTPException(404, "需求不存在")

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    parsed  = _parse_md(content)
    fm      = parsed["frontmatter"]
    form_data = fm.get("form_data", {})
    if isinstance(form_data, str):
        try:
            form_data = json.loads(form_data)
        except Exception:
            form_data = {}

    project_id = fm.get("project_id", "") or form_data.get("project_id", "")
    title      = fm.get("title", "")

    # 標記為 generating
    fm["status"] = "generating"
    body_before_result = parsed["body"].split("## ✅ 生成結果")[0].rstrip()
    _write_md(req_id, fm, "\n" + body_before_result + "\n\n---\n\n## ✅ 生成結果\n\n（生成中...）\n")

    try:
        # RAG 搜尋
        search_q = f"{title} {form_data.get('service_type', '')} 服務內容 合約條件"
        q_vec = await ollama.embed(search_q)
        vec_str = _vec(q_vec)
        where  = "WHERE project_id = :project_id" if project_id else ""
        params: dict = {"embedding": vec_str, "top_k": 6}
        if project_id:
            params["project_id"] = project_id

        from sqlalchemy import text as sa_text
        rows = await db.execute(
            sa_text(f"""
                SELECT filename, content,
                       1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
                FROM documents {where}
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT :top_k
            """),
            params,
        )
        results = rows.fetchall()

        context_parts = [
            f"【{r.filename}】\n{r.content[:1200].strip()}"
            for r in results
            if float(r.relevance) > 0.15
        ]
        context = "\n\n---\n\n".join(context_parts) if context_parts else "（知識庫無匹配資料）"

        # 組 prompt
        field_lines = "\n".join(
            f"- **{k}**：{v}"
            for k, v in form_data.items()
            if k not in ("project_id", "_project_id") and v
        )
        prompt = f"""你是一個專業的政府採購標案顧問。請根據以下過往案件資料和本次文件需求，撰寫一份完整且專業的正式文件。
請使用繁體中文，格式為 Markdown。

## 知識庫參考資料
{context}

## 文件需求
{field_lines}

請根據以上需求，生成一份結構完整、內容具體的正式文件，盡量引用知識庫的過往案件資料。"""

        document = await ollama.chat(prompt)

        sources = [
            {"name": r.filename, "relevance": round(float(r.relevance), 3)}
            for r in results if float(r.relevance) > 0.15
        ]

        # 更新 MD：寫入結果
        now_str = datetime.now().isoformat(timespec="seconds")
        fm["status"]       = "completed"
        fm["completed_at"] = now_str

        result_section = f"""## ✅ 生成結果

> 生成時間：{now_str}
> 參考文件：{len(sources)} 份（{', '.join(s['name'] for s in sources[:3])}{'...' if len(sources) > 3 else ''}）

{document}
"""
        _write_md(req_id, fm, "\n" + body_before_result + "\n\n---\n\n" + result_section)
        return {"ok": True, "document": document, "sources": sources}

    except Exception as exc:
        fm["status"] = "error"
        _write_md(req_id, fm, "\n" + body_before_result + f"\n\n---\n\n## ✅ 生成結果\n\n（生成失敗：{exc}）\n")
        raise HTTPException(500, f"生成失敗：{exc}")
