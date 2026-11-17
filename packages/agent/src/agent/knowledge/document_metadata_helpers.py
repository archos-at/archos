from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING
from typing import Any

from agent.knowledge.document_classification import canonical_doc_class
from agent.knowledge.page_count import page_number

if TYPE_CHECKING:
    pass

from agent.knowledge import document_metadata_store as facade
from agent.knowledge.document_metadata_constants import _RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import REFUSAL_REASON
from agent.knowledge.document_metadata_constants import TABLE_NAME


class LinkOutcome(StrEnum):

    LINKED = "linked"
    LOOP = "loop"
    MISSING = "missing"


def _current_doc_class(value: str | None) -> str | None:
    return canonical_doc_class(value) or value


def dismissed_revisions(suggestion: Any) -> list[str]:
    if not isinstance(suggestion, dict):
        return []
    names = [name for name in suggestion.get("dismissed_of") or () if isinstance(name, str) and name.strip()]
    older = suggestion.get("of")
    if suggestion.get("dismissed") is True and isinstance(older, str) and older.strip() and older not in names:
        names.append(older)
    return list(dict.fromkeys(names))


def _link_lock_key(collection: str) -> int:
    digest = hashlib.sha256(f"grid-fassung-link:{collection}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


@dataclass(frozen=True, slots=True)
class _LinkRow:

    superseded_by: str | None
    change_basis: str | None
    revision_suggestion: str | None


def _set_columns(conn, collection: str, filename: str, **values: Any) -> None:
    from sqlalchemy import text

    unknown = set(values) - set(_RETAINED_COLUMNS)
    if unknown:
        raise ValueError(f"not a Fassung column: {sorted(unknown)}")
    assignments = ", ".join(f"{column} = :{column}" for column in values)
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"UPDATE {TABLE_NAME} SET {assignments} WHERE collection = :collection AND filename = :filename"),
        {**values, "collection": collection, "filename": filename},
    )


def _refusal_record(refused: list[str]) -> dict[str, Any] | None:
    if not refused:
        return None
    return {
        "of": refused[-1],
        "confidence": 0.0,
        "reason": REFUSAL_REASON,
        "basis": "name",
        "dismissed": True,
        "dismissed_of": refused,
    }


def _merged_suggestion(stored: dict[str, Any] | None, new: dict[str, Any] | None) -> dict[str, Any] | None:
    refused = list(dict.fromkeys(dismissed_revisions(stored) + dismissed_revisions(new)))
    if new is None:
        return _refusal_record(refused)
    return {**new, "dismissed": new["of"] in refused, "dismissed_of": refused}


def _with_refusal(stored: dict[str, Any] | None, older: str) -> dict[str, Any]:
    refused = [name for name in dismissed_revisions(stored) if name != older] + [older]
    if stored is None or stored["of"] == older or stored["dismissed"]:
        return {**(stored or {}), **_refusal_record(refused), **_kept_reason(stored, older)}
    return {**stored, "dismissed_of": refused}


def _person_made_facts(
    filename: str,
    superseded_by: str | None,
    revision_suggestion: str | None,
    change_summary: str | None,
    change_basis: str | None,
) -> dict[str, str | None] | None:
    refusals = _merged_suggestion(facade.DocumentMetadataStore._decode_suggestion(revision_suggestion), None)
    linked_change = bool(change_summary) and bool(change_basis) and change_basis != filename
    kept = {
        "superseded_by": superseded_by or None,
        "revision_suggestion": json.dumps(refusals) if refusals else None,
        "change_summary": change_summary if linked_change else None,
        "change_basis": change_basis if linked_change else None,
    }
    return kept if any(kept.values()) else None


def _encode_page_count(page_count: int | None) -> int | None:
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
        return None
    return page_count


def _decode_page_count(raw: Any) -> int | None:
    return page_number(raw)


def _kept_reason(stored: dict[str, Any] | None, older: str) -> dict[str, Any]:
    if stored is None or stored["of"] != older:
        return {}
    return {key: stored[key] for key in ("confidence", "reason", "basis")}


# ``sqlalchemy.text()`` call below carries a ``# nosemgrep: …avoid-sqlalchemy-text``


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
