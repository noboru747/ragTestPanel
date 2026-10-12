"""
遮罩對照表查詢（本機還原顯示用）。
GET  /api/mask/mappings?project_id=X
GET  /api/mask/rescan/preview?project_id=X[&categories=person,ip]   補遮 dry-run（不寫 DB）
POST /api/mask/rescan?project_id=X[&categories=...]                 補遮並更新 documents.content
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.db_service import AsyncSessionLocal, get_db
from services.mask_store import load_mappings, lock_project
from services.masking import LABELS, PLACEHOLDER_RE, apply_known_mappings

router = APIRouter()


def _sort_key(m: dict):
    pm = PLACEHOLDER_RE.fullmatch(m["placeholder"])
    return (m["category"], int(pm.group(2)) if pm else 0, m["placeholder"])


@router.get("/mappings")
async def list_mappings(project_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    mappings = sorted(await load_mappings(db, project_id), key=_sort_key)
    return {"mappings": mappings}


def _parse_categories(categories: str | None) -> set | None:
    if not categories:
        return None
    cats = {c.strip() for c in categories.split(",") if c.strip()}
    return {c for c in cats if c in LABELS} or None


async def _rescan(project_id: str, categories: str | None, apply: bool) -> dict:
    """
    以目前專案對照表的「已知原值」補遮該專案 documents.content（純字串替換，不跑規則、不呼叫外部 API）。
    apply=True 時更新 content 並標記 embedding_stale=TRUE（向量不重算，待之後重新入庫）。
    """
    cats = _parse_categories(categories)
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await lock_project(db, project_id)
            mappings = await load_mappings(db, project_id)
            rows = (await db.execute(
                text("SELECT id, filename, content FROM documents WHERE project_id = :p ORDER BY id"),
                {"p": project_id},
            )).fetchall()
            docs, total, by_cat = [], 0, {}
            for r in rows:
                new_content, counts = apply_known_mappings(r.content or "", mappings, cats)
                n = sum(counts.values())
                if not n:
                    continue
                total += n
                for k, v in counts.items():
                    by_cat[k] = by_cat.get(k, 0) + v
                docs.append({"filename": r.filename, "replaced": n, "by_category": counts})
                if apply:
                    await db.execute(
                        text("UPDATE documents SET content = :c, embedding_stale = TRUE, updated_at = NOW() WHERE id = :id"),
                        {"c": new_content, "id": r.id},
                    )
            stale = (await db.execute(
                text("SELECT count(*) FROM documents WHERE project_id = :p AND embedding_stale"), {"p": project_id},
            )).scalar() if apply else None
    return {
        "project_id": project_id,
        "dry_run": not apply,
        "categories": sorted(cats) if cats else "all",
        "mappings": len(mappings),
        "scanned_documents": len(rows),
        "affected_documents": len(docs),
        "total_replaced": total,
        "by_category": by_cat,
        "documents": docs,
        **({"embedding_stale_documents": stale} if apply else {}),
    }


@router.get("/rescan/preview")
async def rescan_preview(project_id: str = Query(...), categories: str | None = Query(None)):
    return await _rescan(project_id, categories, apply=False)


@router.post("/rescan")
async def rescan_apply(project_id: str = Query(...), categories: str | None = Query(None)):
    return await _rescan(project_id, categories, apply=True)
