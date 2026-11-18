from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from agent.tools.bim.measurement_sources import note_model_read
from agent.tools.bim.query_build import _valid_building_class
from agent.tools.bim.rendering import clipped
from agent.tools.bim.rendering import listed
from agent.tools.bim.rendering import render_unresolved
from agent.tools.bim.rendering import shelf_notice


def _element_link(
    project_id: str | None,
    filename: str | None,
    global_id: str | None,
    status: str = "info",
) -> str:
    if not project_id or not global_id:
        return ""
    tone = status if status in {"pass", "fail", "warning", "info"} else "info"
    query = f"element={quote(global_id, safe='')}&hl={tone}%3A{quote(global_id, safe='')}"
    if filename:
        query = f"model={quote(filename, safe='')}&{query}"
    return f"/app/projects/{quote(project_id, safe='')}/model?{query}"


def _bcf_link(
    project_id: str | None,
    filename: str | None,
    building_class: int | None = 0,
    main_use: str = "",
) -> str:
    if not project_id or not filename:
        return ""
    query = f"model={quote(filename, safe='')}"
    valid_klasse = _valid_building_class(building_class)
    if valid_klasse:
        query = f"{query}&buildingClass={valid_klasse}"
    if main_use:
        query = f"{query}&mainUse={quote(main_use, safe='')}"
    return f"/api/projects/{quote(project_id, safe='')}/bim/checks/export?{query}"


_clipped = clipped

_Lines = list[str | None]


@dataclass(frozen=True)
class _RenderContext:
    project_id: str | None
    filename: str | None
    building_class: int
    main_use: str

    def link(self, global_id: Any, status: str = "info") -> str:
        link = _element_link(self.project_id, self.filename, global_id, status)
        return f" · Link: {link}" if link else ""


def _entry_label(entry: dict[str, Any], storey: bool = True) -> str:
    label = f"{entry.get('ifcType')} „{entry.get('name') or entry.get('globalId')}“"
    return f"{label} · {entry.get('storeyName') or '—'}" if storey else label


def _render_overview(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    overview = result.get("overview")
    if not isinstance(overview, dict):
        return []
    lines: _Lines = []
    storeys = overview.get("storeys") or []
    if storeys:
        lines.append(
            "Storeys: "
            + ", ".join(f"{s.get('name') or '—'} ({s.get('elementCount', 0)} elements)" for s in storeys[:20])
        )
        lines.append(clipped(storeys, 20, "storeys"))
    types = list((overview.get("typeCounts") or {}).items())
    if types:
        lines.append("Element types: " + ", ".join(f"{name} ({count})" for name, count in types[:15]))
        lines.append(clipped(types, 15, "element types"))
    return lines


def _render_elements(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    def row(element: dict[str, Any]) -> str:
        label = element.get("name") or element.get("tag") or element.get("globalId")
        storey = element.get("storeyName") or "—"
        global_id = element.get("globalId")
        return f"- {element.get('ifcType')} „{label}“ · {storey} · GlobalId {global_id}{ctx.link(global_id)}"

    return listed(result.get("elements") or [], 50, "elements", row)


def _render_element(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    element = result.get("element")
    if not isinstance(element, dict):
        return []
    link = _element_link(ctx.project_id, ctx.filename, element.get("globalId"))
    lines: _Lines = [f"GlobalId: {element.get('globalId')}", f"Link: {link}" if link else None]
    if element.get("storeyName"):
        lines.append(f"Storey: {element['storeyName']}")
    if element.get("materials"):
        lines.append("Materials: " + ", ".join(element["materials"]))
    for group in ("properties", "quantities"):
        for set_name, values in (element.get(group) or {}).items():
            lines.append(f"{set_name}: " + ", ".join(f"{key}={value}" for key, value in values.items()))
    return lines


def _render_schedule(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    schedule = result.get("schedule")
    if not isinstance(schedule, dict):
        return []
    area_unit = (schedule.get("units") or {}).get("area", "m²")

    def room(entry: dict[str, Any]) -> str:
        area = entry.get("netFloorArea")
        return f"  · {entry.get('name')} — {area if area is not None else 'no area'}"

    def storey(entry: dict[str, Any]) -> list[str]:
        rooms = entry.get("rooms") or []
        head = f"{entry.get('storeyName')}: {entry.get('netFloorArea')} {area_unit} ({len(rooms)} rooms)"
        return [head, *listed(rooms, 30, "rooms", room, indent="  ")]

    return listed(schedule.get("storeys") or [], 12, "storeys", storey)


def _render_takeoff(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    def row(entry: dict[str, Any]) -> str:
        missing = f", {entry.get('missing')} without a value" if entry.get("missing") else ""
        return f"- {entry.get('group')}: {entry.get('value')} ({entry.get('elements')} elements{missing})"

    return listed(result.get("takeoff") or [], 40, "groups", row)


def _shopping_row(entry: dict[str, Any]) -> str:
    count = entry.get("elements")
    where = "on one element" if count == 1 else f"on {count} elements"
    return f"- missing: {entry.get('path')} {where} (decides: {', '.join(entry.get('rules') or [])})"


def _rule_rows(rule: dict[str, Any], ctx: _RenderContext) -> list[str]:

    def verdict(entry: dict[str, Any]) -> str:
        name = entry.get("name") or entry.get("globalId")
        return f"  ✗ {rule.get('richtlinie')} {name}: {entry.get('reading')}{ctx.link(entry.get('globalId'), 'fail')}"

    failed = int(rule.get("failed") or 0)
    undecidable = int(rule.get("undecidable") or 0)
    hint = f" — {rule['hint']}" if rule.get("hint") else ""
    head = f"- Rule {rule.get('ruleId')}: {rule.get('titleDe')} — {failed} not met, {undecidable} undecidable{hint}"
    lines = [head] if rule.get("ruleId") and (failed or undecidable) else []
    return lines + listed(rule.get("failures") or [], 10, "affected elements", verdict, indent="  ")


def _render_compliance(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    lines: _Lines = listed(result.get("complianceShoppingList") or [], 15, "missing properties", _shopping_row)
    lines += listed(result.get("compliance") or [], 40, "rules", lambda rule: _rule_rows(rule, ctx))
    bcf = _bcf_link(ctx.project_id, ctx.filename, ctx.building_class, ctx.main_use)
    if bcf:
        lines.append(f"BCF export of the open issues: {bcf}")
    return lines


def _render_profile(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    return [
        f"- {s.get('key')} = {s.get('value')} [{s.get('confidence')}] — {s.get('evidence')}"
        for s in result.get("profileSuggestions") or []
    ]


def _render_compare(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    comparison = result.get("comparison")
    if not isinstance(comparison, dict):
        return []

    def changed_row(entry: dict[str, Any]) -> str:
        deltas = "; ".join(
            f"{c.get('field')}: {c.get('before')} → {c.get('after')}" for c in (entry.get("changes") or [])[:6]
        )
        return f"~ {_entry_label(entry, storey=False)} — {deltas}"

    added = comparison.get("added") or []
    removed = comparison.get("removed") or []
    changed = comparison.get("changed") or []
    lines: _Lines = [f"+ {_entry_label(entry)}" for entry in added[:25]]
    lines += [f"- {_entry_label(entry)}" for entry in removed[:25]]
    lines += [changed_row(entry) for entry in changed[:25]]
    lines += [
        clipped(bucket, 25, f"{noun} elements")
        for bucket, noun in ((added, "new"), (removed, "removed"), (changed, "changed"))
    ]
    return lines


def _render_properties(result: dict[str, Any], ctx: _RenderContext) -> _Lines:
    def row(entry: dict[str, Any]) -> str:
        values = ", ".join(f"{v.get('value')} ({v.get('elements')}×)" for v in (entry.get("values") or [])[:6])
        kind = "quantity" if entry.get("source") == "quantity" else "property"
        return f"- [{kind}] {entry.get('set')}.{entry.get('name')}: {values}"

    return listed(result.get("properties") or [], 60, "properties", row)


_QUERY_RENDERERS: dict[str, Callable[[dict[str, Any], _RenderContext], _Lines]] = {
    "overview": _render_overview,
    "elements": _render_elements,
    "element": _render_element,
    "schedule": _render_schedule,
    "takeoff": _render_takeoff,
    "compliance": _render_compliance,
    "compliance-diff": _render_compliance,
    "profile": _render_profile,
    "compare": _render_compare,
    "properties": _render_properties,
}

_PARTIAL_MODEL_OPS = frozenset({"schedule", "takeoff", "compliance", "compliance-diff", "compare", "profile", "health"})


def _truncation_note(op: str) -> str:
    if op in _PARTIAL_MODEL_OPS:
        return (
            "(Warning: these figures cover only part of the model. "
            "They are NOT totals for the building — mark them as such in the text.)"
        )
    return "(More hits exist — narrow the query or aggregate.)"


def _render(
    result: dict[str, Any],
    project_id: str | None = None,
    building_class: int = 0,
    main_use: str = "",
) -> str:
    if not result.get("resolved"):
        return render_unresolved(result, "The model could not be queried.")
    model = result.get("model") or {}
    ctx = _RenderContext(project_id, model.get("filename"), building_class, main_use)
    op = str(result.get("op") or "")
    note_model_read(ctx.filename, op)
    lines: _Lines = [
        shelf_notice(result),
        f"Model: {ctx.filename}" if ctx.filename else None,
        str(result.get("summary") or ""),
        str(result.get("caveat") or ""),
    ]
    renderer = _QUERY_RENDERERS.get(op)
    if renderer is not None:
        lines += renderer(result, ctx)
    if result.get("truncated"):
        lines.append(_truncation_note(op))
    return "\n".join(line for line in lines if line)
