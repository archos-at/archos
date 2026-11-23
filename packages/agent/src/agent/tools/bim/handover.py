from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from agent.tools.bim.measurement_sources import MeasurementSource
from agent.tools.execute.tool_data import ToolData
from agent.tools.execute.tool_data import keep_tool_data

QUERY_ABOUT: dict[str, tuple[str, str]] = {
    "schedule": ("Raumdaten aus dem Modell", "rooms"),
    "elements": ("Bauteilliste aus dem Modell", "elements"),
    "takeoff": ("Mengen aus dem Modell", "groups"),
    "aggregate": ("Mengen aus dem Modell", "groups"),
    "properties": ("Eigenschaften aus dem Modell", "properties"),
    "compare": ("Modellvergleich", "changes"),
    "compliance": ("Prüfergebnis aus dem Modell", "rules"),
    "compliance-diff": ("Prüfergebnis aus dem Modell", "rules"),
    "profile": ("Projektdaten aus dem Modell", "facts"),
}

MEASURE_ABOUT: dict[str, str] = {
    "room_inventory": "Raumdaten aus dem Modell",
    "find_elements": "Bauteilliste aus dem Modell",
    "survey": "Bauteilliste aus dem Modell",
}

MEASURED_ABOUT = "Messwerte aus dem Modell"

QUERY_PROVENANCE = (
    "declared: every value is what the model's property and quantity sets publish, nothing was measured from "
    "geometry. When result.truncated is true the figures cover only part of the model and are not its totals."
)

MEASURE_PROVENANCE = (
    "Each answer in result.payload carries its own provenance (declared, computed with a tolerance, inferred), "
    "method and unit; result.measurements lists the evidence values with the elements they were read from."
)

SKIPPED_MEASURE_OPERATIONS = frozenset({"view", "draw"})

_ROW_KEYS = ("rooms", "elements", "results", "entries", "items")


def _query_rows(operation: str, result: dict[str, Any]) -> int | None:
    if operation == "schedule":
        storeys = (result.get("schedule") or {}).get("storeys") or []
        return sum(len((storey or {}).get("rooms") or []) for storey in storeys)
    for key in ("elements", "takeoff", "groups"):
        if isinstance(result.get(key), list):
            return len(result[key])
    return None


async def with_query_data(result: dict[str, Any], rendered: str) -> str:
    handed = await keep_query_result(result)
    return f"{rendered}\n{handed}" if handed else rendered


async def keep_query_result(result: dict[str, Any]) -> str:
    operation = str(result.get("op") or "")
    if not result.get("resolved") or operation not in QUERY_ABOUT:
        return ""
    about, noun = QUERY_ABOUT[operation]
    model = (result.get("model") or {}).get("filename")
    return await keep_tool_data(
        ToolData(
            tool="ifc_query",
            operation=operation,
            about=about,
            content=result,
            rows=_query_rows(operation, result),
            row_noun=noun,
            model=str(model) if model else None,
            provenance=QUERY_PROVENANCE,
        )
    )


def _measure_rows(payload: dict[str, Any]) -> tuple[int | None, str]:
    for key in _ROW_KEYS:
        if isinstance(payload.get(key), list):
            return len(payload[key]), key
    return None, "rows"


async def keep_measure_result(
    operation: str, detail: str, source: dict[str, Any], payload: Any, evidence: Sequence[MeasurementSource]
) -> str:
    if not source.get("resolved") or not isinstance(payload, dict) or operation in SKIPPED_MEASURE_OPERATIONS:
        return ""
    measurements = [{"headline": entry.headline, **entry.to_wire()["measurement"]} for entry in evidence]
    rows, noun = _measure_rows(payload)
    model = (source.get("model") or {}).get("filename")
    return await keep_tool_data(
        ToolData(
            tool="ifc_measure",
            operation=f"{operation} {detail}".strip(),
            about=MEASURE_ABOUT.get(operation, MEASURED_ABOUT),
            content={"payload": payload, "measurements": measurements},
            rows=rows,
            row_noun=noun,
            model=str(model) if model else None,
            provenance=MEASURE_PROVENANCE,
        )
    )
