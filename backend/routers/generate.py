from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from services.db_service import get_db
from services.ollama_service import ollama
from routers.documents import _vec

router = APIRouter()


@router.post("/proposal")
async def generate_proposal(payload: dict, db: AsyncSession = Depends(get_db)):
    project_id      = payload.get("project_id")
    tender_name     = payload.get("tender_name", "")
    agency_name     = payload.get("agency_name", "")
    service_type    = payload.get("service_type", "")
    bid_amount      = payload.get("bid_amount", "")
    service_period  = payload.get("service_period", "")
    person_count    = payload.get("person_count", "")
    company_name    = payload.get("company_name", "")
    extra           = payload.get("extra_requirements", "")

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")

    # 1. 向量搜尋：從知識庫抓相關資料
    search_q = f"{tender_name} {service_type} 服務內容 人員規格 合約條件 投標"
    q_vec = await ollama.embed(search_q)
    vec_str = _vec(q_vec)

    where = "WHERE project_id = :project_id"
    params: dict = {"embedding": vec_str, "top_k": 6, "project_id": project_id}

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
            FROM documents
            {where}
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    # 2. 組建 RAG context
    context_parts = [
        f"【{r.filename}】\n{r.content[:1200].strip()}"
        for r in results
        if float(r.relevance) > 0.15
    ]
    context = "\n\n---\n\n".join(context_parts) if context_parts else "（知識庫無匹配資料）"

    # 3. Prompt → Ollama 生成
    prompt = f"""你是一個專業的政府採購標案顧問，請根據以下過往案件資料和本次標案資訊，
撰寫一份完整且專業的「投標服務建議書」。
請使用繁體中文，格式為 Markdown。

## 知識庫參考資料（過往類似案件）
{context}

## 本次標案資訊
- 標案名稱：{tender_name}
- 招標機關：{agency_name}
- 服務類型：{service_type}
- 投標金額：{bid_amount} 元
- 服務期間：{service_period}
{f"- 預計派駐人數：{person_count} 人" if person_count else ""}
- 投標廠商名稱：{company_name}
{f"- 特殊需求補充：{extra}" if extra else ""}

請撰寫包含以下七個章節的完整建議書：

# {tender_name} 投標服務建議書

## 一、公司簡介與服務資歷
## 二、服務範圍與工作項目
## 三、人員配置計畫與資格條件
## 四、執行方法與時程規劃
## 五、品質保證措施
## 六、報價明細說明
## 七、廠商服務優勢與結語

請根據知識庫的過往案件資料讓內容更具體，引用相關合約條件與執行經驗。"""

    document = await ollama.chat(prompt)

    sources = [
        {"name": r.filename, "relevance": round(float(r.relevance), 3)}
        for r in results
        if float(r.relevance) > 0.15
    ]

    return {"document": document, "sources": sources}


@router.post("/from-template")
async def generate_from_template(payload: dict, db: AsyncSession = Depends(get_db)):
    template_id = payload.get("template_id", "")
    project_id  = payload.get("project_id", "")
    fields: dict = payload.get("fields", {})

    # 1. 從 DB 查 template
    row = await db.execute(
        text("SELECT name, fields FROM document_templates WHERE id = :template_id"),
        {"template_id": template_id},
    )
    template = row.fetchone()
    if not template:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")

    template_name = template.name

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")

    # 2. 建立 RAG 查詢 prompt（用欄位值組合 query string）
    query = " ".join(str(v) for v in fields.values() if v)

    # 3. 向量搜尋（top_k=5，限制同 project_id）
    q_vec = await ollama.embed(query)
    vec_str = _vec(q_vec)

    where = "WHERE project_id = :project_id"
    params: dict = {"embedding": vec_str, "top_k": 5, "project_id": project_id}

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
            FROM documents
            {where}
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    # 4. 組建 RAG context
    context_parts = [
        f"【{r.filename}】\n{r.content[:1200].strip()}"
        for r in results
        if float(r.relevance) > 0.15
    ]
    context = "\n\n---\n\n".join(context_parts) if context_parts else "（知識庫無匹配資料）"

    # 5. 組建案件資訊段落
    fields_text = "\n".join(f"- {k}：{v}" for k, v in fields.items())

    # 6. Prompt → Ollama 生成（timeout=180）
    prompt = f"""你是一位專業的政府採購顧問，請根據以下資訊生成一份建議書草稿。

案件資訊：
{fields_text}

相關參考資料：
{context}

請輸出以下結構（每個段落用 ## 標題分隔）：
## 前言
## 服務範圍
## 執行方式
## 預期效益
## 結語"""

    content = await ollama.chat(prompt, timeout=180)

    sources = [
        {"filename": r.filename, "relevance": round(float(r.relevance), 3)}
        for r in results
        if float(r.relevance) > 0.15
    ]

    return {
        "template_name": template_name,
        "fields": fields,
        "content": content,
        "sources": sources,
    }
