from fastapi import APIRouter, Depends
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

    # 1. 向量搜尋：從知識庫抓相關資料
    search_q = f"{tender_name} {service_type} 服務內容 人員規格 合約條件 投標"
    q_vec = await ollama.embed(search_q)
    vec_str = _vec(q_vec)

    where = "WHERE project_id = :project_id" if project_id else ""
    params: dict = {"embedding": vec_str, "top_k": 6}
    if project_id:
        params["project_id"] = project_id

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
