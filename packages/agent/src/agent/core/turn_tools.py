from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from agent.common.client_tools import KNOWN_CLIENT_TOOLS
from agent.common.client_tools import client_tool_declared
from agent.common.tool_calls import tool_basename
from agent.project_context import get_project_id_from_context

_PROJECT_MODEL_TOOLS = frozenset({"ifc_query", "ifc_measure"})

_MODEL_KIND_OF_TOOL = {"ifc_query": "ifc", "ifc_measure": "ifc", "dxf_measure": "dxf"}

_project_models: ContextVar[frozenset[str] | None] = ContextVar("turn_project_models", default=None)


def set_project_models(kinds: frozenset[str] | None) -> None:
    _project_models.set(kinds)


def tools_in_scope(tools: list[Any]) -> list[Any]:
    in_project = bool(get_project_id_from_context())
    models = _project_models.get()

    def runs_here(tool: Any) -> bool:
        name = tool_basename(getattr(tool, "name", "") or "")
        if name in KNOWN_CLIENT_TOOLS:
            return client_tool_declared(name)
        if models is not None and name in _MODEL_KIND_OF_TOOL:
            return _MODEL_KIND_OF_TOOL[name] in models
        return in_project or name not in _PROJECT_MODEL_TOOLS

    return [tool for tool in tools if runs_here(tool)]
