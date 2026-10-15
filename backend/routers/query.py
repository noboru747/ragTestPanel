"""
RAG 查詢端點：切段混合檢索（向量 + 中文二元組關鍵字）+ LLM 生成答案
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from services.db_service import get_db
from services.mask_store import load_mappings
from services.masking import extract_mappings, mask_question
from services.ollama_service import ollama
from services.retrieval import Hit, build_context, merge_adjacent, search_chunks
from services.usage import set_usage_project

MASK_PROMPT_NOTE = "文件中形如【類別_N】（例如【IP_1】、【帳號_2】）的文字為敏感資料遮罩代號，回答時請原樣保留代號，不要猜測、還原或改寫其內容。"

SOURCE_MIN_RELEVANCE = 0.3
SNIPPET_CHARS = 800          # 前端段落展開用（遮罩後文字；一般段落 ≤ 600 字，表格長列可能較長）


def build_rag_prompt(context_text: str, question: str) -> str:
    return f"""你是一個專業的專案管理助手，根據以下知識庫文件來回答 PM 的問題。
請使用繁體中文回答，答案要具體且有條理。若文件中沒有足夠資訊，請如實說明。
參考資料以「【文件：檔名｜第 N 段】」標示出處，回答時可引用檔名與段號。
{MASK_PROMPT_NOTE}

## 知識庫文件內容

{context_text}

## PM 的問題

{question}

請根據上述文件內容回答："""


router = APIRouter()


def source_dict(h: Hit) -> dict:
    """sources 契約：每段一筆（同一文件多段 → 多筆，依 relevance 排序）。chunk_index 0 起算。"""
    return {
        "docId": h.filename,
        "docName": h.filename,
        "filename": h.filename,
        "relevance": round(h.relevance, 4),
        "vector_score": round(h.vector_score, 4),
        "keyword_score": round(h.keyword_score, 4),
        "snippet": h.content[:SNIPPET_CHARS],
        "chunk_index": h.chunk_index,
        "chunk_total": h.chunk_total,
        "char_start": h.char_start,
        "char_end": h.char_end,
    }


async def retrieve_for_question(db: AsyncSession, question: str, project_id: str, top_k: int,
                                max_chars: int | None = None):
    """函式層（不呼叫 LLM）：遮罩問題 → embed → 混合檢索 → 合併相鄰段 → 組上下文。"""
    mappings = await load_mappings(db, project_id)
    masked_q, question_masked = mask_question(question, mappings)
    q_embedding = await ollama.embed(masked_q)
    hits = await search_chunks(db, q_embedding, masked_q, project_id, top_k=top_k)
    context_text, used_blocks = build_context(merge_adjacent(hits), max_chars)
    return {
        "question": masked_q, "question_masked": question_masked, "mappings": mappings,
        "hits": hits, "context": context_text, "blocks": used_blocks,
    }


@router.post("/rag")
async def rag_query(payload: dict, db: AsyncSession = Depends(get_db)):
    question = payload.get("question", "").strip()
    project_id = payload.get("project_id")
    top_k = int(payload.get("top_k", settings.rag_top_k))

    if not question:
        return {"answer": "請輸入問題。", "sources": [], "question_masked": 0, "mappings": []}

    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")
    set_usage_project(project_id)

    r = await retrieve_for_question(db, question, project_id, top_k)
    if not r["hits"]:
        return {
            "answer": "目前知識庫中沒有相關文件。請先透過 OCR 入庫頁面上傳並建立文件索引，再進行查詢。",
            "sources": [],
            "question_masked": r["question_masked"],
            "mappings": [],
        }

    answer = await ollama.chat(build_rag_prompt(r["context"], r["question"]))

    sources = [h for h in r["hits"] if h.relevance > SOURCE_MIN_RELEVANCE]
    used_texts = [b.content for b in r["blocks"]]
    return {
        "answer": answer,
        "question_masked": r["question_masked"],
        "mappings": extract_mappings([answer, *used_texts], r["mappings"]),
        "sources": [source_dict(h) for h in sources],
    }
