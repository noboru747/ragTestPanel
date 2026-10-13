"""
mask_mappings 對照表存取（專案範圍，只存在本機 PostgreSQL）。
original_value 是明文敏感資料：只供本機還原顯示，切勿送往外部 API。
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_project(db: AsyncSession, project_id: str) -> None:
    """交易層級 advisory lock：同專案同時上傳多檔時，避免代號編號衝突（交易結束自動釋放）"""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": "mask:" + project_id})


async def load_mappings(db: AsyncSession, project_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT placeholder, category, original_value, filenames, updated_at
            FROM mask_mappings WHERE project_id = :p
        """),
        {"p": project_id},
    )
    return [
        {
            "placeholder": r.placeholder,
            "category": r.category,
            "original": r.original_value,
            "filenames": list(r.filenames or []),
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows.fetchall()
    ]


async def upsert_mappings(db: AsyncSession, project_id: str, mappings: list[dict], filename: str) -> None:
    """新代號 INSERT；已存在的代號把 filename 追加進 filenames（不重複）"""
    for m in mappings:
        await db.execute(
            text("""
                INSERT INTO mask_mappings (project_id, placeholder, category, original_value, filenames)
                VALUES (:p, :ph, :cat, :orig, CASE WHEN :fn = '' THEN '{}'::text[] ELSE ARRAY[:fn] END)
                ON CONFLICT (project_id, placeholder) DO UPDATE SET
                    filenames = CASE
                        WHEN :fn = '' OR :fn = ANY(mask_mappings.filenames) THEN mask_mappings.filenames
                        ELSE array_append(mask_mappings.filenames, :fn)
                    END,
                    updated_at = NOW()
            """),
            {"p": project_id, "ph": m["placeholder"], "cat": m["category"], "orig": m["original"], "fn": filename or ""},
        )
