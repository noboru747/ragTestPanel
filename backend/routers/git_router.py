import asyncio
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.git_service import clone_or_pull, get_project_context

router = APIRouter()


class CloneRequest(BaseModel):
    url: str
    branch: str = "main"


@router.get("/validate")
async def validate_git_url(url: str = Query(...)):
    """嘗試 git ls-remote 驗證 URL 是否可連線（不 clone，只驗證）"""
    if not url or not url.startswith(("http://", "https://", "git@", "ssh://")):
        return {"valid": False, "reason": "URL 格式不正確"}

    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "ls-remote", "--exit-code", "--heads", url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)

        if proc.returncode == 0:
            return {"valid": True, "reason": ""}
        elif proc.returncode == 2:
            return {"valid": True, "reason": "空 repo（無 branch）"}
        else:
            err = stderr.decode(errors="replace").strip().splitlines()
            reason = err[-1] if err else "無法連線"
            return {"valid": False, "reason": reason}

    except asyncio.TimeoutError:
        return {"valid": False, "reason": "連線逾時（10 秒）"}
    except Exception as e:
        return {"valid": False, "reason": str(e)}


@router.post("/clone")
async def clone_repo(req: CloneRequest):
    try:
        result = await clone_or_pull(req.url, req.branch)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/context")
async def repo_context(url: str):
    try:
        ctx = await get_project_context(url)
        return {
            "features": ctx["features"],
            "instruction_count": len(ctx["instructions"]),
            "instructions": [
                {
                    "section": i.section,
                    "feature_name": i.feature_name,
                    "preview": i.instruction[:200],
                }
                for i in ctx["instructions"]
            ],
            "has_readme": bool(ctx["readme"]),
            "has_deploy_notes": bool(ctx["deploy_notes"]),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Repo 尚未 clone")
