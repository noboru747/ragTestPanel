from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from services.db_service import get_db
from services.ollama_service import ollama

router = APIRouter()


def _vec(embedding: list[float]) -> str:
    """將 embedding list 轉成 pgvector 可接受的字串格式 '[0.1,0.2,...]'"""
    return "[" + ",".join(str(v) for v in embedding) + "]"


@router.post("/index")
async def index_document(payload: dict, db: AsyncSession = Depends(get_db)):
    doc_text = payload.get("text", "")
    project_id = payload.get("project_id", "default")
    filename = payload.get("filename", "")

    embedding = await ollama.embed(doc_text[:4000])

    await db.execute(
        text("""
            INSERT INTO documents (project_id, filename, content, embedding)
            VALUES (:project_id, :filename, :content, CAST(:embedding AS vector))
            ON CONFLICT (project_id, filename)
            DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding
        """),
        {
            "project_id": project_id,
            "filename": filename,
            "content": doc_text,
            "embedding": _vec(embedding),
        },
    )
    await db.commit()
    return {"status": "indexed", "filename": filename}


@router.post("/search")
async def search_documents(payload: dict, db: AsyncSession = Depends(get_db)):
    query = payload.get("query", "")
    project_id = payload.get("project_id")
    top_k = payload.get("top_k", 5)

    query_embedding = await ollama.embed(query)
    vec_str = _vec(query_embedding)

    where_clause = "WHERE project_id = :project_id" if project_id else ""
    params: dict = {"embedding": vec_str, "top_k": top_k}
    if project_id:
        params["project_id"] = project_id

    rows = await db.execute(
        text(f"""
            SELECT filename, content,
                   1 - (embedding <=> CAST(:embedding AS vector)) AS relevance
            FROM documents
            {where_clause}
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """),
        params,
    )
    results = rows.fetchall()

    return {
        "query": query,
        "results": [
            {"filename": r.filename, "content": r.content[:500], "relevance": round(r.relevance, 4)}
            for r in results
        ],
    }


@router.get("/list")
async def list_documents(
    project_id: str | None = Query(None),
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    where = "WHERE project_id = :project_id" if project_id else ""
    params: dict = {"limit": limit}
    if project_id:
        params["project_id"] = project_id

    rows = await db.execute(
        text(f"""
            SELECT id, project_id, filename, length(content) AS char_count,
                   file_type, tags, created_at
            FROM documents
            {where}
            ORDER BY created_at DESC
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
