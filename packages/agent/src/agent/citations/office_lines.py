from __future__ import annotations

import contextvars
from typing import Any

from agent.citations.entries import SourceEntry
from agent.common.knowledge_context import FRESHNESS

_ROLES = {"interpretation": "interpretation", "authority_practice": "authority_practice"}

_office_labels: contextvars.ContextVar[dict[str, dict[str, object]]] = contextvars.ContextVar(
    "_office_labels", default={}
)


def set_turn_office_labels(labels: tuple[dict[str, object], ...] | None) -> None:
    _office_labels.set({str(label["editionId"]): label for label in labels or () if label.get("editionId")})


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def office_line_fields(entry: SourceEntry) -> dict[str, Any]:
    label = _office_labels.get().get(entry.edition_id or "")
    if label is None:
        return {}
    freshness = label.get("freshness")
    return {
        "role": _ROLES.get(str(label.get("role"))),
        "work_id": _text(label.get("workId")),
        "edition_id": _text(label.get("editionId")),
        "designation": _text(label.get("designation")),
        "edition_label": _text(label.get("editionLabel")),
        "last_checked_at": _text(label.get("lastCheckedOn")),
        "freshness": freshness if freshness in FRESHNESS else None,
    }
