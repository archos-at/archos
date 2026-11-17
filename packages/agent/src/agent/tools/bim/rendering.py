from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.tools.bim.failures import NO_MODEL_TEXT
from agent.tools.bim.failures import NOT_READY_TEXT

_SINGULAR = {
    "storeys": "storey",
    "elements": "element",
    "element types": "element type",
    "affected elements": "affected element",
    "rooms": "room",
    "rooms without a door edge": "room without a door edge",
    "rules": "rule",
    "groups": "group",
    "properties": "property",
    "missing properties": "missing property",
    "new elements": "new element",
    "removed elements": "removed element",
    "changed elements": "changed element",
    "entries": "entry",
    "undetermined doors": "undetermined door",
    "excluded doors": "excluded door",
}


def clipped(items: list, shown: int, noun: str) -> str | None:
    missing = len(items) - shown
    if missing <= 0:
        return None
    if missing == 1:
        return f"… 1 more {_SINGULAR.get(noun, noun)} not shown."
    return f"… {missing} more {noun} not shown."


def listed(
    items: list,
    shown: int,
    noun: str,
    render: Callable[[Any], str | list[str]],
    *,
    indent: str = "",
) -> list[str]:
    lines: list[str] = []
    for item in items[:shown]:
        rendered = render(item)
        lines.extend([rendered] if isinstance(rendered, str) else rendered)
    note = clipped(items, shown, noun)
    return lines + [f"{indent}{note}"] if note else lines


_NOTHING_TO_READ = {
    "no_models": NO_MODEL_TEXT,
    "extraction_failed": NO_MODEL_TEXT,
    "not_ready": NOT_READY_TEXT,
}


def render_unresolved(result: dict[str, Any], fallback: str) -> str:
    text = _unresolved_message(result, fallback)
    advice = _NOTHING_TO_READ.get(str(result.get("reason")))
    return f"{text} {advice}" if advice else text


def _shelf_suffix(model: dict[str, Any]) -> str:
    return ", office shelf, not the project's" if model.get("shelf") == "office" else ""


def shelf_notice(result: dict[str, Any]) -> str | None:
    selection = result.get("selection")
    if not isinstance(selection, dict) or selection.get("shelf") != "office":
        return None
    own = (
        "This project has no IFC model of its own."
        if selection.get("projectHasOwnModel") is False
        else "The project's own model was not the one named."
    )
    return (
        "NOTICE: this is an office-shelf model (Büroablage), not this project's building. "
        f"{own} State this in the answer; do not describe these figures as the project's."
    )


def _unresolved_message(result: dict[str, Any], fallback: str) -> str:
    message = result.get("message") or fallback
    models = result.get("models") or []
    if not models:
        return str(message)
    listed_models = ", ".join(
        f"{m.get('filename')} ({m.get('status')}, {m.get('elements', 0)} elements{_shelf_suffix(m)})"
        for m in models[:10]
    )
    reason = result.get("reason")
    if reason == "no_own_model":
        heading = (
            "This project has NO IFC model of its own. Office-shelf models (they belong to no project, often "
            "samples; read one only if the user names it, via model_name, and never present it as this "
            "project's building)"
        )
    elif reason in {"no_match", "ambiguous"}:
        heading = "Available models"
    else:
        heading = "Models in this project (not yet queryable)"
    return f"{message} {heading}: {listed_models}."
