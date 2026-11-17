from __future__ import annotations

from typing import Any

LEGACY_PLAN_GENRE: dict[str, str] = {
    "pruefbericht": "inspection_report",
    "aktenvermerk": "file_note",
    "vergleich": "comparison",
    "checkliste": "checklist",
    "bericht": "report",
}

LEGACY_PLAN_DEPTH: dict[str, str] = {
    "kurzpruefung": "quick_check",
    "gutachten": "expert_report",
}

LEGACY_PLAN_KEYS: dict[str, str] = {
    "grundlage": "basis",
    "ausgeschlossen": "excluded",
    "unterlagen": "documents",
}


def modernize_plan(raw: Any) -> Any:
    if not isinstance(raw, dict):
        return raw
    out = dict(raw)
    for old, new in LEGACY_PLAN_KEYS.items():
        if old in out:
            value = out.pop(old)
            out.setdefault(new, value)
    genre = out.get("genre")
    if isinstance(genre, str):
        out["genre"] = LEGACY_PLAN_GENRE.get(genre, genre)
    depth = out.get("depth")
    if isinstance(depth, str):
        out["depth"] = LEGACY_PLAN_DEPTH.get(depth, depth)
    return out
