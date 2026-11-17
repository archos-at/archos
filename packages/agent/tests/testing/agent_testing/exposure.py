from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import yaml

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "Taskfile.yml").is_file())
CONFIG = ROOT / "configs" / "config_oib_openrouter.yml"
EXPOSURE = ROOT / "apps" / "workspace" / "tests" / "fixtures" / "exposure.json"
CHAT_AGENT = "shallow_research_agent"


def _canvas_members() -> set[str]:
    from agent.tools.canvas.register import DESCRIPTIONS

    return set(DESCRIPTIONS)


GROUP_MEMBERS: dict[str, Callable[[], set[str]]] = {"document_canvas": _canvas_members}


def chat_tool_names() -> set[str]:
    config = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    groups = config.get("function_groups") or {}
    names: set[str] = set()
    agent = config["functions"][CHAT_AGENT]
    if agent.get("filesystem"):
        from agent.tools.documents.tools import ESTATE_TOOL_NAMES

        names.update(ESTATE_TOOL_NAMES)
    for tool in agent["tools"]:
        group = groups.get(tool)
        if group is None:
            names.add(tool)
            continue
        members = GROUP_MEMBERS.get(group["_type"])
        if members is not None:
            names.update(f"{tool}__{member}" for member in members())
    return names
