"""
切段混合檢索（document_chunks）：向量（cosine）+ 中文二元組關鍵字（tsvector）。

score = HYBRID_VECTOR_WEIGHT × 向量相似度 + HYBRID_KEYWORD_WEIGHT × 關鍵字分數
關鍵字分數 = ts_rank / 本次候選中最大 ts_rank（正規化到 0~1；沒有任何命中則為 0）
候選 = 向量前 N 段 ∪ 關鍵字前 N 段（N = max(top_k × 6, 50)），只取未被取代（superseded_by IS NULL）的文件。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text as sql
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from services.indexer import vec_literal
from services.keywords import build_tsquery


@dataclass
class Hit:
    document_id: int
    filename: str
    chunk_index: int
    chunk_total: int
    char_start: int
    char_end: int
    content: str
    vector_score: float
    keyword_score: float
    relevance: float


@dataclass
class Block:
    """組上下文用：同文件相鄰段合併後的一塊。"""
    filename: str
    first_index: int
    last_index: int
    chunk_total: int
    content: str
    relevance: float
    hits: list[Hit] = field(default_factory=list)

    @property
    def label(self) -> str:
        seg = (f"第 {self.first_index + 1} 段" if self.first_index == self.last_index
               else f"第 {self.first_index + 1}-{self.last_index + 1} 段")
        return f"【文件：{self.filename}｜{seg}】"


async def search_chunks(db: AsyncSession, query_embedding: list[float], query_text: str,
                        project_id: str | None, top_k: int | None = None,
                        vector_weight: float | None = None, keyword_weight: float | None = None) -> list[Hit]:
    top_k = top_k or settings.rag_top_k
    vw = settings.hybrid_vector_weight if vector_weight is None else vector_weight
    kw = settings.hybrid_keyword_weight if keyword_weight is None else keyword_weight
    tsq = build_tsquery(query_text)
    n_cand = max(top_k * 6, 50)
    # HNSW + project 過濾：開 iterative scan 避免過濾後候選不足（pgvector ≥ 0.8）
    try:
        await db.execute(sql("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        await db.execute(sql("SET LOCAL hnsw.ef_search = 200"))
    except Exception:  # noqa: BLE001
        await db.rollback()
    proj = "c.project_id = :project_id" if project_id else "TRUE"
    rows = (await db.execute(sql(f"""
        WITH q AS (
            SELECT CAST(:emb AS vector) AS v,
                   CASE WHEN :tsq = '' THEN NULL ELSE to_tsquery('simple', :tsq) END AS tq
        ),
        vec AS (
            SELECT c.id FROM document_chunks c
             WHERE {proj} AND c.embedding IS NOT NULL
             ORDER BY c.embedding <=> (SELECT v FROM q) LIMIT :n
        ),
        kwc AS (
            SELECT c.id FROM document_chunks c, q
             WHERE {proj} AND q.tq IS NOT NULL AND c.keywords_tsv @@ q.tq
             ORDER BY ts_rank(c.keywords_tsv, q.tq) DESC LIMIT :n
        ),
        cand AS (SELECT id FROM vec UNION SELECT id FROM kwc),
        scored AS (
            SELECT c.id, c.document_id, c.chunk_index, c.char_start, c.char_end, c.content,
                   1 - (c.embedding <=> q.v) AS vector_score,
                   COALESCE(ts_rank(c.keywords_tsv, q.tq), 0) AS kw_raw
              FROM document_chunks c JOIN cand USING (id), q
        )
        SELECT s.*, d.filename,
               (SELECT count(*) FROM document_chunks x WHERE x.document_id = s.document_id) AS chunk_total,
               CASE WHEN max(s.kw_raw) OVER () > 0 THEN s.kw_raw / max(s.kw_raw) OVER () ELSE 0 END AS keyword_score
          FROM scored s JOIN documents d ON d.id = s.document_id
         WHERE d.superseded_by IS NULL
    """), {"emb": vec_literal(query_embedding), "tsq": tsq, "n": n_cand,
           **({"project_id": project_id} if project_id else {})})).fetchall()
    hits = [
        Hit(document_id=r.document_id, filename=r.filename, chunk_index=r.chunk_index,
            chunk_total=int(r.chunk_total), char_start=r.char_start, char_end=r.char_end, content=r.content,
            vector_score=float(r.vector_score or 0), keyword_score=float(r.keyword_score or 0),
            relevance=vw * float(r.vector_score or 0) + kw * float(r.keyword_score or 0))
        for r in rows
    ]
    hits.sort(key=lambda h: h.relevance, reverse=True)
    return hits[:top_k]


def merge_adjacent(hits: list[Hit]) -> list[Block]:
    """
    依文件分組（文件順序 = 該文件最高分），文件內依 chunk_index 排序，相鄰段（index 差 1）合併成一塊；
    合併時去掉重疊部分（依 char_start / char_end）。
    """
    by_doc: dict[int, list[Hit]] = {}
    for h in hits:
        by_doc.setdefault(h.document_id, []).append(h)
    order = sorted(by_doc, key=lambda d: max(h.relevance for h in by_doc[d]), reverse=True)
    blocks: list[Block] = []
    for d in order:
        hs = sorted(by_doc[d], key=lambda h: h.chunk_index)
        cur: Block | None = None
        cur_end = 0
        for h in hs:
            if cur and h.chunk_index == cur.last_index + 1:
                overlap = max(0, cur_end - h.char_start)
                cur.content += ("" if overlap else "\n") + h.content[overlap:]
                cur.last_index = h.chunk_index
                cur.relevance = max(cur.relevance, h.relevance)
                cur.hits.append(h)
                cur_end = h.char_end
            else:
                cur = Block(h.filename, h.chunk_index, h.chunk_index, h.chunk_total, h.content, h.relevance, [h])
                blocks.append(cur)
                cur_end = h.char_end
    return blocks


def build_context(blocks: list[Block], max_chars: int | None = None) -> tuple[str, list[Block]]:
    """組上下文（依文件分組、標示段號），總字數上限 max_chars；回傳 (上下文, 實際用到的 blocks)。"""
    max_chars = max_chars or settings.effective_context_max_chars
    parts: list[str] = []
    used: list[Block] = []
    total = 0
    for b in blocks:
        piece = f"{b.label}\n{b.content.strip()}"
        sep = 7 if parts else 0                         # "\n\n---\n\n"
        remain = max_chars - total - sep
        if remain <= 0:
            break
        if len(piece) > remain:
            if remain < 200:
                break
            piece = piece[: remain - 1].rstrip() + "…"
        parts.append(piece)
        used.append(b)
        total += len(piece) + sep
    return "\n\n---\n\n".join(parts), used


async def retrieve_context(db: AsyncSession, query: str, project_id: str | None, top_k: int = 6,
                           max_chars: int | None = None) -> tuple[str, list[Hit]]:
    """給 generate / requests 用的簡化介面：embed 查詢 → 混合檢索 → 合併 → 上下文。"""
    from services.ollama_service import ollama
    q_vec = await ollama.embed(query)
    hits = await search_chunks(db, q_vec, query, project_id, top_k=top_k)
    context, _ = build_context(merge_adjacent(hits), max_chars)
    return context, hits


@dataclass
class DocRow:
    """相容舊程式（generate / requests）的 row：filename / content / relevance。content = 合併後的段落。"""
    filename: str
    content: str
    relevance: float


async def search_doc_rows(db: AsyncSession, query: str, project_id: str | None, top_k: int = 6) -> list[DocRow]:
    """embed 查詢 → 切段混合檢索 → 同文件相鄰段合併 → 每塊一筆 row（依分數排序）。"""
    from services.ollama_service import ollama
    q_vec = await ollama.embed(query)
    hits = await search_chunks(db, q_vec, query, project_id, top_k=top_k)
    blocks = merge_adjacent(hits)
    blocks.sort(key=lambda b: b.relevance, reverse=True)
    return [DocRow(b.filename, b.content, b.relevance) for b in blocks]
