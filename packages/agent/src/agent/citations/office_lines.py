"""The citation line of a passage read from the office's own copy of a standard (ADR-0163, ticket 32).

``citations/roles.py`` resolves a passage's edition against the turn's knowledge context, which holds the
platform's records; an office's copy is not law there, and its label is the office layer's (that module's
last paragraph). The BFF sends those labels with the turn (``baseKnowledgeLabels``,
``bff/base-knowledge/office/answer-label.ts``), one per confirmed copy the turn may read. This module binds
them per turn and answers, for a passage, the same line fields ``role_fields`` gives a platform edition:
which edition (``designation``, ``edition_label``, ``work_id``, ``edition_id``), what it is
(``role``: a commentary is interpretation, a directive authority practice; a standard's role is the law's
that refers to it, so none is stated), when the office last checked it and how current that leaves it.
One line object for both, so the formatter that words it (``docs/design/citations.md`` slice 2) needs no
second form for office copies.

A passage finds its label BY ITS EDITION ID, the ``knowledge_edition_id`` its points are marked with; a
file name decides nothing. Nothing bound, nothing found: the line stays empty, as before.
"""

from __future__ import annotations

import contextvars
from typing import Any

from agent.citations.entries import SourceEntry
from agent.common.knowledge_context import FRESHNESS

#: What the office's answer role is as an edition role (``EDITION_ROLES``); a requirement source states none.
_ROLES = {"interpretation": "interpretation", "authority_practice": "authority_practice"}

_office_labels: contextvars.ContextVar[dict[str, dict[str, object]]] = contextvars.ContextVar(
    "_office_labels", default={}
)


def set_turn_office_labels(labels: tuple[dict[str, object], ...] | None) -> None:
    """Bind this turn's office labels by edition id. Called on every turn, ``None`` included: that is the reset."""
    _office_labels.set({str(label["editionId"]): label for label in labels or () if label.get("editionId")})


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def office_line_fields(entry: SourceEntry) -> dict[str, Any]:
    """The line fields of a passage of an office copy, or ``{}`` when the turn labels none.

    Pure over the bound labels.
    """
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
