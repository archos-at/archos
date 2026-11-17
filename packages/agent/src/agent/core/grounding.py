from __future__ import annotations

from agent.common.tool_calls import tool_basename
from agent.tools.bim.measurement_evidence import result_carries_measurement

MEASUREMENT_TOOL_NAMES: frozenset[str] = frozenset({"ifc_measure"})

_TOOL_ERROR_PREFIX = "error:"


def tool_result_is_measurement(tool_name: str, content: str) -> bool:
    if tool_basename(tool_name) not in MEASUREMENT_TOOL_NAMES:
        return False
    text = (content or "").strip()
    if not text or text[: len(_TOOL_ERROR_PREFIX)].lower() == _TOOL_ERROR_PREFIX:
        return False
    return result_carries_measurement(text)
