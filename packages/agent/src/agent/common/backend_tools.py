from __future__ import annotations

from typing import Any
from typing import Final

BACKEND_READ_TOOLS: Final[tuple[str, ...]] = (
    "knowledge_search",
    "read_passage",
    "list_files",
    "look",
    "ifc_measure",
    "dxf_measure",
    "law_lookup",
)

READ_ONLY_ANNOTATIONS: Final[dict[str, bool]] = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}


def is_backend_read_tool(name: str) -> bool:
    return name in BACKEND_READ_TOOLS


def describe_backend_tool(name: str, description: str, input_schema: type[Any]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": input_schema.model_json_schema(),
        "annotations": dict(READ_ONLY_ANNOTATIONS),
    }
