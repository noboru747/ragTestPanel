"""
文件入庫 / 重新切段的共用流程：壓縮 → 上限截斷 → 切段 → embedding（批次）→ 寫 documents + document_chunks。

documents.content 存「壓縮後全文」（不截斷）：保留完整內容，日後調高 MAX_DOC_CHARS 可直接重切，
不必回頭找原檔；只有切段 / embedding 套用 MAX_DOC_CHARS，並以 truncated / original_chars 標記。
documents.embedding 用第一段的向量（相容舊程式，不額外呼叫平台）。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text as sql
from sqlalchemy.ext.asyncio import AsyncSession

from services import chunker
from services.keywords import document_keyword_text
from services.ollama_service import ollama


def vec_literal(embedding: list[float]) -> str:
    return "[" + ",".join(str(v) for v in embedding) + "]"


@dataclass
class Prepared:
    content: str              # 壓縮後全文（存 documents.content）
    original_chars: int       # 壓縮前字數
    truncated: bool           # 切段時是否只取前 MAX_DOC_CHARS 字
    chunks: list[chunker.Chunk]

    @property
    def embed_chars(self) -> int:
        from config import settings
        return sum(min(len(c.content), settings.embed_max_chars) for c in self.chunks)


def prepare(raw: str, max_doc_chars: int | None = None) -> Prepared:
    content = chunker.compress_text(raw)
    limited, truncated = chunker.limit_text(content, chunker.MAX_DOC_CHARS if max_doc_chars is None else max_doc_chars)
    return Prepared(content, len(raw), truncated, chunker.chunk_text(limited))


async def embed_chunks(prep: Prepared) -> list[list[float]]:
    return await ollama.embed_many([c.content for c in prep.chunks])


async def write_document(db: AsyncSession, project_id: str, filename: str, prep: Prepared,
                         embeddings: list[list[float]]) -> int:
    """upsert documents（以 (project_id, filename)）並重寫其 chunks。呼叫端負責 commit。"""
    first = vec_literal(embeddings[0]) if embeddings else None
    doc_id = (await db.execute(sql("""
        INSERT INTO documents (project_id, filename, content, embedding, truncated, original_chars)
        VALUES (:project_id, :filename, :content, CAST(:embedding AS vector), :truncated, :original_chars)
        ON CONFLICT (project_id, filename)
        DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding,
                      truncated = EXCLUDED.truncated, original_chars = EXCLUDED.original_chars,
                      embedding_stale = FALSE, updated_at = NOW()
        RETURNING id
    """), {"project_id": project_id, "filename": filename, "content": prep.content, "embedding": first,
           "truncated": prep.truncated, "original_chars": prep.original_chars})).scalar_one()
    await replace_chunks(db, doc_id, project_id, prep, embeddings)
    return doc_id


async def replace_chunks(db: AsyncSession, doc_id: int, project_id: str, prep: Prepared,
                         embeddings: list[list[float]]) -> None:
    await db.execute(sql("DELETE FROM document_chunks WHERE document_id = :d"), {"d": doc_id})
    if not prep.chunks:
        return
    await db.execute(sql("""
        INSERT INTO document_chunks (document_id, project_id, chunk_index, content, char_start, char_end,
                                     embedding, keywords_tsv)
        VALUES (:d, :p, :i, :c, :s, :e, CAST(:emb AS vector), to_tsvector('simple', :kw))
    """), [
        {"d": doc_id, "p": project_id, "i": ch.index, "c": ch.content, "s": ch.start, "e": ch.end,
         "emb": vec_literal(emb), "kw": document_keyword_text(ch.content)}
        for ch, emb in zip(prep.chunks, embeddings)
    ])


async def rechunk_existing(db: AsyncSession, doc_id: int, project_id: str, content: str,
                           original_chars: int | None, prep: Prepared, embeddings: list[list[float]]) -> None:
    """重新切段既有文件：更新壓縮後內容與截斷標記；documents.embedding 保留不動。"""
    await db.execute(sql("""
        UPDATE documents SET content = :c, truncated = :t,
               original_chars = COALESCE(original_chars, :o), embedding_stale = FALSE
         WHERE id = :id
    """), {"c": prep.content, "t": prep.truncated, "o": original_chars or len(content), "id": doc_id})
    await replace_chunks(db, doc_id, project_id, prep, embeddings)
