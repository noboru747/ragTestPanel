"""
解析 PM 在 MD 文件中寫的代理人指令。

約定格式：
## 指令給 AI
<任意指令內容>

### 功能：<功能名稱>
- 需求描述
"""
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AgentInstruction:
    source_file: str
    section: str
    instruction: str
    feature_name: str | None = None
    metadata: dict = field(default_factory=dict)


def parse_md_file(filepath: str | Path) -> list[AgentInstruction]:
    text = Path(filepath).read_text(encoding="utf-8")
    return parse_md_text(text, source_file=str(filepath))


def parse_md_text(text: str, source_file: str = "") -> list[AgentInstruction]:
    instructions: list[AgentInstruction] = []

    # 找所有「指令給 AI」區塊
    ai_blocks = re.finditer(
        r"###?\s*指令給\s*AI\s*\n(.*?)(?=\n###?\s|\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    for match in ai_blocks:
        content = match.group(1).strip()
        if content:
            instructions.append(
                AgentInstruction(
                    source_file=source_file,
                    section="ai_instruction",
                    instruction=content,
                )
            )

    # 找功能需求區塊
    feature_blocks = re.finditer(
        r"###?\s*功能[：:]\s*(.+?)\n(.*?)(?=\n###?\s|\Z)",
        text,
        re.DOTALL,
    )
    for match in feature_blocks:
        feature_name = match.group(1).strip()
        content = match.group(2).strip()
        if content:
            instructions.append(
                AgentInstruction(
                    source_file=source_file,
                    section="feature_request",
                    instruction=content,
                    feature_name=feature_name,
                )
            )

    return instructions


def extract_project_context(repo_path: str | Path) -> dict:
    """讀取 repo 內所有 MD，彙整成專案上下文"""
    repo = Path(repo_path)
    context: dict = {
        "readme": "",
        "features": [],
        "deploy_notes": "",
        "instructions": [],
    }

    for md_file in repo.rglob("*.md"):
        relative = md_file.relative_to(repo)
        text = md_file.read_text(encoding="utf-8", errors="ignore")

        name_lower = md_file.name.lower()
        if name_lower == "readme.md":
            context["readme"] = text
        elif name_lower == "deploy.md":
            context["deploy_notes"] = text
        elif name_lower == "features.md":
            context["features"] = _extract_list_items(text)

        # 所有 MD 都掃指令
        parsed = parse_md_text(text, source_file=str(relative))
        context["instructions"].extend(parsed)

    return context


def _extract_list_items(text: str) -> list[str]:
    return [
        m.group(1).strip()
        for m in re.finditer(r"^[-*]\s+(.+)$", text, re.MULTILINE)
    ]
