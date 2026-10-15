import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from services.db_service import get_db
from services.doc_errors import classify_db_error, classify_embedding_error, precheck_index_text
from services.indexer import embed_chunks, prepare, vec_literal, write_document
from services.ollama_service import ollama
from services.retrieval import search_chunks
from services.usage import set_usage_project

router = APIRouter()
logger = logging.getLogger(__name__)


def _vec(embedding: list[float]) -> str:
    """將 embedding list 轉成 pgvector 可接受的字串格式 '[0.1,0.2,...]'（保留給舊呼叫端）"""
    return vec_literal(embedding)


@router.post("/index")
async def index_document(payload: dict, db: AsyncSession = Depends(get_db)):
    """
    存文件 → 切段 → 逐批算 embedding → 寫 document_chunks。

    - 文字先做空白 / 空儲存格壓縮；documents.content 存壓縮後全文
    - 壓縮後超過 MAX_DOC_CHARS（預設 300000）→ 只切段前 N 字，回應與 documents 標記 truncated
    - documents.embedding = 第一段的向量（相容舊程式）
    失敗時回結構化錯誤 {error_code, reason, hint, detail}：
      empty_text(422) / nul_in_text(422) / embedding_failed(502) / db_error(500)
    文字本身不做修復（修復由 /api/ocr/extract repair=true 負責），以保留原始狀況。
    """
    doc_text = payload.get("text", "")
    project_id = payload.get("project_id", "default")
    filename = payload.get("filename", "")
    set_usage_project(project_id)

    pre = precheck_index_text(doc_text)
    if pre:
        return pre.response()

    prep = prepare(doc_text)
    if not prep.chunks:
        pre = precheck_index_text("")
        return pre.response()

    try:
        embeddings = await embed_chunks(prep)
    except Exception as exc:
        logger.warning("embedding 失敗 %s/%s：%s", project_id, filename, exc)
        return classify_embedding_error(exc).response()

    try:
        await write_document(db, project_id, filename, prep, embeddings)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.warning("入庫寫入失敗 %s/%s：%s", project_id, filename, exc)
        return classify_db_error(exc).response()
    return {
        "status": "indexed",
        "filename": filename,
        "chunks": len(prep.chunks),
        "truncated": prep.truncated,
        "original_chars": prep.original_chars,
        "stored_chars": len(prep.content),
        "embed_chars": prep.embed_chars,
    }


@router.post("/search")
async def search_documents(payload: dict, db: AsyncSession = Depends(get_db)):
    """切段混合檢索。results 每筆 = 一段（同一文件可出現多次）。"""
    query = payload.get("query", "")
    project_id = payload.get("project_id")
    top_k = int(payload.get("top_k", 5))
    set_usage_project(project_id)

    query_embedding = await ollama.embed(query)
    hits = await search_chunks(db, query_embedding, query, project_id, top_k=top_k)
    return {
        "query": query,
        "results": [
            {"filename": h.filename, "content": h.content[:500], "relevance": round(h.relevance, 4),
             "chunk_index": h.chunk_index, "chunk_total": h.chunk_total,
             "char_start": h.char_start, "char_end": h.char_end}
            for h in hits
        ],
    }


@router.get("/list")
async def list_documents(
    project_id: str | None = Query(None),
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    where = "WHERE d.project_id = :project_id" if project_id else ""
    params: dict = {"limit": limit}
    if project_id:
        params["project_id"] = project_id

    rows = await db.execute(
        text(f"""
            SELECT d.id, d.project_id, d.filename, length(d.content) AS char_count,
                   d.file_type, d.tags, d.created_at, d.embedding_stale, d.truncated, d.original_chars,
                   (SELECT count(*) FROM document_chunks c WHERE c.document_id = d.id) AS chunk_count
            FROM documents d
            {where}
            ORDER BY d.created_at DESC
            LIMIT :limit
        """),
        params,
    )
    docs = rows.fetchall()
    return {
        "documents": [
            {
                "id": str(d.id),
                "name": d.filename,
                "project_id": d.project_id,
                "type": d.file_type or _guess_type(d.filename),
                "size": f"{d.char_count} 字元",
                "uploadedAt": d.created_at.strftime("%Y-%m-%d") if d.created_at else "",
                "status": "indexed",
                "tags": d.tags or [],
                "summary": "",
                "embeddingStale": bool(d.embedding_stale),
                "chunkCount": int(d.chunk_count),
                "truncated": bool(d.truncated),
                "originalChars": d.original_chars,
            }
            for d in docs
        ]
    }


def _guess_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {"pdf": "pdf", "docx": "word", "doc": "word",
            "xlsx": "excel", "xls": "excel",
            "pptx": "ppt", "ppt": "ppt",
            "jpg": "image", "jpeg": "image", "png": "image"}.get(ext, "file")
