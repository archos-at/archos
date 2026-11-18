from __future__ import annotations

from collections import Counter
from typing import Any

MAX_RENDERED_NEEDS = 60
MAX_RENDERED_FILES = 40
MAX_WHY_CHARS = 160
MAX_OPTIONS_RENDERED = 30


def _options_text(need: dict[str, Any]) -> str:
    options = [option for option in need.get("options") or [] if isinstance(option, dict)]
    if not options:
        return ""
    shown = ", ".join(f"{option.get('token')} ({option.get('label')})" for option in options[:MAX_OPTIONS_RENDERED])
    more = f", … {len(options) - MAX_OPTIONS_RENDERED} more" if len(options) > MAX_OPTIONS_RENDERED else ""
    return f" · options: {shown}{more}"


def render_need(need: dict[str, Any]) -> str:
    flags = "[decisive] " if need.get("decisive") else ""
    unit = f", {need['unit']}" if need.get("unit") else ""
    found_in = ", ".join(str(item) for item in need.get("foundIn") or [])
    why = str(need.get("why") or "").strip()
    why = (why[:MAX_WHY_CHARS] + "…") if len(why) > MAX_WHY_CHARS else why
    parts = [f"- {flags}{need.get('key')} — {need.get('label')} ({need.get('type')}{unit}) · {need.get('state')}"]
    parts.append(_options_text(need))
    if found_in:
        parts.append(f" · found in: {found_in}")
    if why:
        parts.append(f" · why: {why}")
    return "".join(parts)


_STATE_ORDER = {"open": 0, "suggested": 1, "confirmed": 2}


def _need_order(need: dict[str, Any]) -> tuple[int, int]:
    return (0 if need.get("decisive") else 1, _STATE_ORDER.get(str(need.get("state")), 1))


def render_needs(body: dict[str, Any], start: int = 0) -> str:
    needs = sorted((need for need in body.get("needs") or [] if isinstance(need, dict)), key=_need_order)
    unread = [str(name) for name in body.get("unreadFiles") or []]
    lines = [f"Mode: {body.get('mode') or 'active'}"]
    if body.get("description"):
        lines.append(f"Description by the person who created the project: {body['description']}")
    location = body.get("location")
    if isinstance(location, dict) and location.get("label"):
        lines.append(f"Address chosen at creation: {location['label']}")
    states = Counter(str(need.get("state")) for need in needs)
    lines.append(
        f"\nNeeds: {len(needs)} ({states['open']} open, {states['suggested']} suggested so far, "
        f"{states['confirmed']} confirmed by a person)"
    )
    start = max(0, min(start, len(needs)))
    shown = needs[start : start + MAX_RENDERED_NEEDS]
    if start:
        lines.append(f"[Needs {start + 1}–{start + len(shown)} of {len(needs)}.]")
    lines.extend(render_need(need) for need in shown)
    rest = len(needs) - start - len(shown)
    if rest > 0:
        lines.append(
            f"[{rest} more needs not listed (bounded at {MAX_RENDERED_NEEDS}): intake_needs(start="
            f"{start + len(shown)}) lists them. Recording moves an open need behind the open ones.]"
        )
    if not needs:
        lines.append("Nothing is needed any more: finish the intake.")
    lines.append(f"\nFiles not read by any reading yet: {len(unread)}")
    lines.extend(f"- {name}" for name in unread[:MAX_RENDERED_FILES])
    if len(unread) > MAX_RENDERED_FILES:
        lines.append(f"[{len(unread) - MAX_RENDERED_FILES} more; list_files shows every file.]")
    return "\n".join(lines)
