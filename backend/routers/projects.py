from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel

from services.db_service import get_db

router = APIRouter()


class ProjectCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    git_url: str | None = None
    status: str = "active"
    tags: list[str] = []


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    git_url: str | None = None
    status: str | None = None
    tags: list[str] | None = None


@router.get("")
async def list_projects(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("""
        SELECT p.id, p.name, p.description, p.git_url, p.status, p.tags, p.created_at,
               COUNT(d.id) AS doc_count
        FROM projects p
        LEFT JOIN documents d ON d.project_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    """))
    projects = rows.fetchall()

    # 真實統計
    stats_row = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM projects)                          AS total_projects,
            (SELECT COUNT(*) FROM documents)                         AS total_documents,
            (SELECT COUNT(*) FROM documents WHERE embedding IS NOT NULL) AS indexed_documents
    """))
    stats = stats_row.fetchone()

    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description or "",
                "gitRepo": p.git_url,
                "gitConnected": bool(p.git_url),
                "status": p.status,
                "tags": p.tags or [],
                "docCount": int(p.doc_count),
                "lastUpdated": p.created_at.strftime("%Y-%m-%d") if p.created_at else "",
            }
            for p in projects
        ],
        "stats": {
            "totalProjects": int(stats.total_projects),
            "totalDocuments": int(stats.total_documents),
            "indexedDocuments": int(stats.indexed_documents),
            "totalQueries": 0,
        },
    }


@router.post("", status_code=201)
async def create_project(payload: ProjectCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        text("SELECT id FROM projects WHERE id = :id"), {"id": payload.id}
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail=f"專案 ID '{payload.id}' 已存在")

    await db.execute(
        text("""
            INSERT INTO projects (id, name, description, git_url, status, tags)
            VALUES (:id, :name, :description, :git_url, :status, :tags)
        """),
        {
            "id": payload.id,
            "name": payload.name,
            "description": payload.description,
            "git_url": payload.git_url,
            "status": payload.status,
            "tags": payload.tags,
        },
    )
    await db.commit()
    return {"status": "created", "id": payload.id}


@router.patch("/{project_id}")
async def update_project(
    project_id: str, payload: ProjectUpdate, db: AsyncSession = Depends(get_db)
):
    row = await db.execute(
        text("SELECT id FROM projects WHERE id = :id"), {"id": project_id}
    )
    if not row.fetchone():
        raise HTTPException(status_code=404, detail="專案不存在")

    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        return {"status": "no_change"}

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["project_id"] = project_id
    await db.execute(
        text(f"UPDATE projects SET {set_clause} WHERE id = :project_id"), updates
    )
    await db.commit()
    return {"status": "updated"}


@router.delete("/{project_id}")
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
    )
    await db.commit()
    return {"status": "deleted"}
