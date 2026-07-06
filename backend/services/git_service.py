import os
import re
from pathlib import Path

import git

from config import settings
from services.md_parser import extract_project_context


def _repo_dir(repo_url: str) -> Path:
    slug = re.sub(r"[^\w-]", "_", repo_url.split("/")[-1].replace(".git", ""))
    return Path(settings.git_workspace) / slug


async def clone_or_pull(repo_url: str, branch: str = "main") -> dict:
    target = _repo_dir(repo_url)
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        repo = git.Repo(target)
        origin = repo.remotes.origin
        origin.pull(branch)
        action = "pulled"
    else:
        repo = git.Repo.clone_from(repo_url, target, branch=branch)
        action = "cloned"

    structure = _scan_structure(target)
    context = extract_project_context(target)

    return {
        "action": action,
        "url": repo_url,
        "branch": branch,
        "local_path": str(target),
        "structure": structure,
        "features": context["features"],
        "pending_instructions": len(context["instructions"]),
        "has_deploy_notes": bool(context["deploy_notes"]),
    }


async def get_project_context(repo_url: str) -> dict:
    target = _repo_dir(repo_url)
    if not target.exists():
        raise FileNotFoundError(f"Repo not cloned yet: {repo_url}")
    return extract_project_context(target)


def _scan_structure(path: Path, max_depth: int = 3) -> list[dict]:
    items = []
    for entry in sorted(path.iterdir()):
        if entry.name.startswith(".") or entry.name in ("node_modules", "__pycache__"):
            continue
        rel = str(entry.relative_to(path))
        if entry.is_dir():
            items.append({"path": rel + "/", "type": "dir"})
            if rel.count(os.sep) < max_depth:
                items.extend(_scan_structure(entry, max_depth))
        else:
            items.append({"path": rel, "type": "file"})
    return items
