"""
RAG 查詢端點：向量搜尋 + Ollama 生成答案
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from services.db_service import get_db
from services.mask_store import load_mappings
from services.masking import extract_mappings, mask_question
from services.ollama_service import ollama
from routers.documents import _vec

MASK_PROMPT_NOTE = "文件中形如【類別_N】（例如【IP_1】、【帳號_2】）的文字為敏感資料遮罩代號，回答時請原樣保留代號，不要猜測、還原或改寫其內容。"


def build_rag_prompt(context_text: str, question: str) -> str:
    return f"""你是一個專業的專案管理助手，根據以下知識庫文件來回答 PM 的問題。
請使用繁體中文回答，答案要具體且有條理。若文件中沒有足夠資訊，請如實說明。
{MASK_PROMPT_NOTE}

## 知識庫文件內容

{context_text}

## PM 的問題

{question}

請根據上述文件內容回答："""

router = APIRouter()


@router.post("/rag")
async def rag_query(payload: dict, db: AsyncSession = Depends(get_db)):
    question = payload.get("question", "").strip()
    project_id = payload.get("project_id")
    top_k = int(payload.get("top_k", 5))

    if not question:
        return {"answer": "請輸入問題。", "sources": [], "question_masked": 0, "mappings": []}

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")

    # 0. 以專案遮罩對照表把問題中的敏感原值換成代號（之後 embedding / LLM 只用遮罩後問題）
    mappings = await load_mappings(db, project_id)
    question, question_masked = mask_question(question, mappings)

    # 1. 將問題向量化
    q_embedding = await ollama.embed(question)
    vec_str = _vec(q_embedding)

    # 2. 從 pgvector 取回最相關文件片段（Hybrid Search: pgvector 0.7 + BM25 0.3）
    where = "WHERE project_id = :project_id"
    params: dict = {
        "embedding": vec_str,
        "top_k": top_k,
        "project_id": project_id,
        "query_text": question,
    }

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   (1 - (embedding <=> CAST(:embedding AS vector))) * 0.7
                   + COALESCE(ts_rank(content_tsv, plainto_tsquery('simple', :query_text)), 0) * 0.3 AS relevance
            FROM documents
            {where}
              AND superseded_by IS NULL
            ORDER BY relevance DESC
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    # 3. 若知識庫為空，直接告知
    if not results:
        return {
            "answer": "目前知識庫中沒有相關文件。請先透過 OCR 入庫頁面上傳並建立文件索引，再進行查詢。",
            "sources": [],
            "question_masked": question_masked,
            "mappings": [],
        }

    # 4. 組建 RAG prompt
    context_parts = []
    for r in results:
        snippet = r.content[:1500].strip()
        context_parts.append(f"【文件：{r.filename}】\n{snippet}")
    context_text = "\n\n---\n\n".join(context_parts)

    prompt = build_rag_prompt(context_text, question)

    answer = await ollama.chat(prompt)

    sources = [r for r in results if float(r.relevance) > 0.3]
    snippets = [r.content[:1500] for r in sources]
    return {
        "answer": answer,
        "question_masked": question_masked,
        "mappings": extract_mappings([answer, *snippets], mappings),
        "sources": [
            {
                "docId": r.filename,
                "docName": r.filename,
                "relevance": round(float(r.relevance), 4),
            }
            for r in sources
        ],
    }
