from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING
from typing import Any

from agent.knowledge.document_classification import canonical_doc_class
from agent.knowledge.page_count import page_number

if TYPE_CHECKING:
    pass

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


def dismissed_revision_ids(suggestion: Any) -> list[str]:
    if not isinstance(suggestion, dict):
        return []
    ids = [value for value in suggestion.get("dismissed_of_ids") or () if isinstance(value, str) and value.strip()]
    older = suggestion.get("of_id")
    if suggestion.get("dismissed") is True and isinstance(older, str) and older.strip() and older not in ids:
        ids.append(older)
    return list(dict.fromkeys(ids))


def is_refused(suggestion: Any, older: str, older_id: str | None = None) -> bool:
    return older in dismissed_revisions(suggestion) or bool(older_id and older_id in dismissed_revision_ids(suggestion))


def names_older(suggestion: Mapping[str, Any], older: str, older_id: str | None = None) -> bool:
    own_id = suggestion.get("of_id")
    if older_id and own_id:
        return own_id == older_id
    return suggestion.get("of") == older


def _link_lock_key(collection: str) -> int:
    digest = hashlib.sha256(f"grid-fassung-link:{collection}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def node_key(file_name: str, document_id: str | None) -> str:
    return f"id:{document_id}" if document_id else f"name:{file_name}"


@dataclass(frozen=True, slots=True)
class _LinkRow:
    superseded_by: str | None
    change_basis: str | None
    revision_suggestion: str | None
    file_name: str = ""
    document_id: str | None = None


def link_rows(rows: Iterable[Any]) -> dict[str, _LinkRow]:
    rows = list(rows)
    by_name: dict[str, list[str]] = {}
    for row in rows:
        by_name.setdefault(row[0], []).append(node_key(row[0], row[1]))

    def target(name: str | None, document_id: str | None) -> str | None:
        if document_id:
            return node_key("", document_id)
        if not name:
            return None
        holders = by_name.get(name, [])
        if len(holders) > 1:
            return None
        return holders[0] if holders else node_key(name, None)

    return {
        node_key(row[0], row[1]): _LinkRow(
            superseded_by=target(row[2], row[3]),
            change_basis=row[4],
            revision_suggestion=row[5],
            file_name=row[0],
            document_id=row[1] or None,
        )
        for row in rows
    }


def resolve_node(rows: Mapping[str, _LinkRow], file_name: str | None, document_id: str | None) -> str | None:
    if document_id:
        return node_key("", document_id)
    if not file_name:
        return None
    holders = [key for key, row in rows.items() if row.file_name == file_name]
    if len(holders) > 1:
        return None
    return holders[0] if holders else node_key(file_name, None)


def _match(filename: str, document_id: str | None) -> tuple[str, dict[str, Any]]:
    if not document_id:
        return "document_id IS NULL AND filename = :filename", {"filename": filename}
    return "document_id = :document_id", {"document_id": document_id}


def _stamp(document_id: str | None) -> str:
    return ", document_id = COALESCE(document_id, :document_id)" if document_id else ""


def _batch_match(filenames: Iterable[str], document_ids: Iterable[str] | None) -> tuple[str, dict[str, Any]] | None:
    names = [name for name in dict.fromkeys(filenames) if name]
    ids = [value for value in dict.fromkeys(document_ids or ()) if value]
    clauses = []
    params: dict[str, Any] = {}
    if names:
        clauses.append("(document_id IS NULL AND filename IN :filenames)")
        params["filenames"] = names
    if ids:
        clauses.append("document_id IN :document_ids")
        params["document_ids"] = ids
    if not clauses:
        return None
    return f"({' OR '.join(clauses)})", params


def _batch_bind(statement: Any, params: Mapping[str, Any]) -> Any:
    from sqlalchemy import bindparam

    return statement.bindparams(
        *(bindparam(key, expanding=True) for key in ("filenames", "document_ids") if key in params)
    )


def _batch_keys(filename: str, document_id: str | None, names: set[str], ids: set[str]) -> list[str]:
    if document_id:
        return [document_id] if document_id in ids else []
    return [filename] if filename in names else []


def _exact_match(filename: str, document_id: str | None) -> tuple[str, dict[str, Any]]:
    if document_id:
        return "document_id = :document_id", {"document_id": document_id}
    return "document_id IS NULL AND filename = :filename", {"filename": filename}


def _set_columns(conn, collection: str, filename: str, *, document_id: str | None = None, **values: Any) -> None:
    from sqlalchemy import text

    unknown = set(values) - set(_RETAINED_COLUMNS)
    if unknown:
        raise ValueError(f"not a Fassung column: {sorted(unknown)}")
    assignments = ", ".join(f"{column} = :{column}" for column in values)
    where, keyed = _exact_match(filename, document_id)
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"UPDATE {TABLE_NAME} SET {assignments} WHERE collection = :collection AND {where}"),
        {**values, **keyed, "collection": collection},
    )


def _refusal_record(refused: list[str], refused_ids: list[str] | None = None) -> dict[str, Any] | None:
    if not refused:
        return None
    record: dict[str, Any] = {
        "of": refused[-1],
        "confidence": 0.0,
        "reason": REFUSAL_REASON,
        "basis": "name",
        "dismissed": True,
        "dismissed_of": refused,
    }
    if refused_ids:
        record["dismissed_of_ids"] = refused_ids
    return record


def _merged_suggestion(stored: dict[str, Any] | None, new: dict[str, Any] | None) -> dict[str, Any] | None:
    refused = list(dict.fromkeys(dismissed_revisions(stored) + dismissed_revisions(new)))
    refused_ids = list(dict.fromkeys(dismissed_revision_ids(stored) + dismissed_revision_ids(new)))
    if new is None:
        return _refusal_record(refused, refused_ids)
    refusals = {"dismissed_of": refused, "dismissed_of_ids": refused_ids}
    merged = {**new, "dismissed": is_refused(refusals, new["of"], new.get("of_id")), "dismissed_of": refused}
    if refused_ids:
        merged["dismissed_of_ids"] = refused_ids
    return merged


def _with_refusal(stored: dict[str, Any] | None, older: str, older_id: str | None = None) -> dict[str, Any]:
    refused = [name for name in dismissed_revisions(stored) if name != older] + [older]
    refused_ids = [value for value in dismissed_revision_ids(stored) if value != older_id] + (
        [older_id] if older_id else []
    )
    record = _refusal_record(refused, refused_ids) or {}
    if stored is None or names_older(stored, older, older_id) or stored["dismissed"]:
        kept = {**(stored or {}), **record, **_kept_reason(stored, older, older_id)}
        if older_id:
            kept["of_id"] = older_id
        else:
            kept.pop("of_id", None)
        return kept
    return {**stored, "dismissed_of": refused, **({"dismissed_of_ids": refused_ids} if refused_ids else {})}


def _person_made_facts(filename: str, stored: Mapping[str, Any]) -> dict[str, str | None] | None:
    from agent.knowledge.document_metadata_store import DocumentMetadataStore

    refusals = _merged_suggestion(DocumentMetadataStore._decode_suggestion(stored["revision_suggestion"]), None)
    change_summary, change_basis = stored["change_summary"], stored["change_basis"]
    linked_change = bool(change_summary) and bool(change_basis) and change_basis != filename
    kept = {
        "superseded_by": stored["superseded_by"] or None,
        "superseded_by_id": stored.get("superseded_by_id") or None,
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


def _kept_reason(stored: dict[str, Any] | None, older: str, older_id: str | None = None) -> dict[str, Any]:
    if stored is None or not names_older(stored, older, older_id):
        return {}
    return {key: stored[key] for key in ("confidence", "reason", "basis")}


# ``sqlalchemy.text()`` call below carries a ``# nosemgrep: …avoid-sqlalchemy-text``


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
