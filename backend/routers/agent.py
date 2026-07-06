"""
PM 透過 MD 和 AI 代理人互動的核心端點。
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ollama_service import ollama
from services.git_service import get_project_context

router = APIRouter()


class AgentRequest(BaseModel):
    instruction: str
    repo_url: str | None = None
    project_context: str | None = None
    stream: bool = False


class AgentResponse(BaseModel):
    result: str
    model: str
    source_context: str | None = None


def _build_prompt(instruction: str, context: dict | None) -> str:
    parts = ["你是一個專業的專案管理助手，協助 PM 根據專案現況生成所需文件。\n"]

    if context:
        if context.get("readme"):
            parts.append(f"## 專案說明\n{context['readme'][:2000]}\n")
        if context.get("features"):
            feat_list = "\n".join(f"- {f}" for f in context["features"])
            parts.append(f"## 現有功能\n{feat_list}\n")
        if context.get("deploy_notes"):
            parts.append(f"## 部署資訊\n{context['deploy_notes'][:1000]}\n")

    parts.append(f"## PM 指令\n{instruction}")
    return "\n".join(parts)


@router.post("/run", response_model=AgentResponse)
async def run_agent(req: AgentRequest):
    context = None
    if req.repo_url:
        try:
            context = await get_project_context(req.repo_url)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Repo 尚未 clone，請先呼叫 /api/git/clone")

    prompt = _build_prompt(req.instruction, context)

    result = await ollama.chat(prompt)

    return AgentResponse(
        result=result,
        model=ollama.base_url,
        source_context="git_repo" if context else "direct",
    )


@router.post("/run/stream")
async def run_agent_stream(req: AgentRequest):
    context = None
    if req.repo_url:
        try:
            context = await get_project_context(req.repo_url)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Repo 尚未 clone")

    prompt = _build_prompt(req.instruction, context)

    async def token_generator():
        async for token in ollama.chat_stream(prompt):
            yield token

    return StreamingResponse(token_generator(), media_type="text/plain")


@router.post("/parse-md")
async def parse_md_instructions(payload: dict):
    """直接送 MD 文字，回傳解析出的指令清單"""
    from services.md_parser import parse_md_text
    md_text = payload.get("content", "")
    instructions = parse_md_text(md_text, source_file="inline")
    return {
        "count": len(instructions),
        "instructions": [
            {
                "section": i.section,
                "feature_name": i.feature_name,
                "instruction": i.instruction[:300],
            }
            for i in instructions
        ],
    }
