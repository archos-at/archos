from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from urllib.parse import unquote

from agent.common.bff_http import BffMalformedResponseError
from agent.common.bff_http import get_json
from agent.knowledge.document_metadata_constants import RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_helpers import _exact_match
from agent.knowledge.document_metadata_schema import drop_name_primary_keys
from agent.knowledge.document_metadata_schema import name_primary_keys

DOCUMENT_IDS_PATH = "/api/internal/document-ids"
_TIMEOUT_SECONDS = 60.0
_TMP_UPLOAD_PREFIX = re.compile(r"^tmp.{8}_")
_TABLES = (TABLE_NAME, RETAINED_TABLE_NAME)
PRIMARY_KEY_STORE = "primary key (collection, filename)"


def _name_key(name: str) -> str:
    return unicodedata.normalize("NFC", name)


def _spellings(stored: str) -> list[str]:
    plain = unquote(_TMP_UPLOAD_PREFIX.sub("", stored))
    return list(dict.fromkeys(_name_key(spelling) for spelling in (stored, plain)))


@dataclass(frozen=True)
class LiveDocuments:
    collection: str
    ids_by_name: Mapping[str, str]
    ambiguous: frozenset[str] = frozenset()

    @classmethod
    def of(cls, collection: str, documents: Iterable[tuple[str, str]]) -> LiveDocuments:
        ids: dict[str, set[str]] = {}
        for document_id, filename in documents:
            ids.setdefault(_name_key(filename), set()).add(document_id)
        return cls(
            collection,
            {name: next(iter(held)) for name, held in ids.items() if len(held) == 1},
            frozenset(name for name, held in ids.items() if len(held) > 1),
        )

    def holds_exactly(self, stored: str) -> bool:
        return _name_key(stored) in self.ids_by_name

    def id_for(self, stored: str | None) -> str | None:
        for spelling in _spellings(stored or ""):
            if spelling in self.ids_by_name:
                return self.ids_by_name[spelling]
        return None


def live_documents(collection: str) -> LiveDocuments:
    body = get_json(DOCUMENT_IDS_PATH, timeout=_TIMEOUT_SECONDS, query={"collection": collection})
    rows = body.get("documents") if isinstance(body, dict) else None
    if not isinstance(rows, list):
        raise BffMalformedResponseError(f"{DOCUMENT_IDS_PATH} answered without a documents list")
    found = []
    for row in rows:
        document_id = row.get("id") if isinstance(row, dict) else None
        filename = row.get("filename") if isinstance(row, dict) else None
        if not isinstance(document_id, str) or not document_id or not isinstance(filename, str) or not filename:
            raise BffMalformedResponseError(f"{DOCUMENT_IDS_PATH} answered a row without id and filename")
        found.append((document_id, filename))
    return LiveDocuments.of(collection, found)


@dataclass
class StoreCount:
    store: str
    before: int = 0
    written: int = 0
    after: int = 0
    unmatched: int = 0


@dataclass
class _Plan:
    keys: list[tuple[str, str]] = field(default_factory=list)
    links: list[tuple[str, str | None, str]] = field(default_factory=list)
    suggestions: list[tuple[str, str | None, str]] = field(default_factory=list)
    unmatched: dict[str, int] = field(default_factory=lambda: {"document_id": 0, "superseded_by_id": 0})


def _with_ids(raw: str | None, live: LiveDocuments) -> str | None:
    from agent.knowledge.document_metadata_store import DocumentMetadataStore

    stored = DocumentMetadataStore._decode_suggestion(raw)
    if stored is None:
        return None
    keyed: dict[str, Any] = dict(stored)
    older_id = live.id_for(stored["of"])
    if older_id and not stored.get("of_id"):
        keyed["of_id"] = older_id
    refused_ids = list(stored.get("dismissed_of_ids") or [])
    for name in stored["dismissed_of"]:
        refused = live.id_for(name)
        if refused and refused not in refused_ids:
            refused_ids.append(refused)
    if refused_ids:
        keyed["dismissed_of_ids"] = refused_ids
    return json.dumps(keyed) if keyed != stored else None


def _plan(conn, table: str, live: LiveDocuments) -> _Plan:
    from sqlalchemy import text

    plan = _Plan()
    rows = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"SELECT filename, document_id, superseded_by, superseded_by_id, revision_suggestion FROM {table} "
            "WHERE collection = :collection"
        ),
        {"collection": live.collection},
    ).fetchall()
    held = {row[1] for row in rows if row[1]}
    unkeyed = sorted((row[0] for row in rows if not row[1]), key=lambda name: (not live.holds_exactly(name), name))
    for filename in unkeyed:
        own_id = live.id_for(filename)
        if own_id and own_id not in held:
            held.add(own_id)
            plan.keys.append((filename, own_id))
        else:
            plan.unmatched["document_id"] += 1
    for filename, document_id, superseded_by, superseded_by_id, suggestion in rows:
        if superseded_by and not superseded_by_id:
            newer_id = live.id_for(superseded_by)
            if newer_id:
                plan.links.append((filename, document_id, newer_id))
            else:
                plan.unmatched["superseded_by_id"] += 1
        keyed = _with_ids(suggestion, live)
        if keyed is not None:
            plan.suggestions.append((filename, document_id, keyed))
    return plan


def _apply_keys(conn, table: str, plan: _Plan, collection: str) -> int:
    from sqlalchemy import text

    written = 0
    for filename, document_id in plan.keys:
        written += (
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {table} SET document_id = :document_id WHERE collection = :collection "
                    "AND filename = :filename AND document_id IS NULL "
                    f"AND NOT EXISTS (SELECT 1 FROM {table} AS keyed "
                    "WHERE keyed.collection = :collection AND keyed.document_id = :document_id)"
                ),
                {"collection": collection, "filename": filename, "document_id": document_id},
            ).rowcount
            or 0
        )
    return written


def _apply_values(conn, table: str, column: str, items: list[tuple[str, str | None, str]], collection: str) -> int:
    from sqlalchemy import text

    written = 0
    for filename, document_id, value in items:
        where, keyed = _exact_match(filename, document_id)
        written += (
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"UPDATE {table} SET {column} = :value WHERE collection = :collection AND {where}"),
                {"collection": collection, "value": value, **keyed},
            ).rowcount
            or 0
        )
    return written


def _sizes(plan: _Plan) -> dict[str, int]:
    return {
        "document_id": len(plan.keys),
        "superseded_by_id": len(plan.links),
        "revision_suggestion": len(plan.suggestions),
    }


def rekey_collection(store, live: LiveDocuments, *, apply: bool) -> list[StoreCount]:
    counts = []
    with store._sync_engine.begin() as conn:
        for table in _TABLES:
            plan = _plan(conn, table, live)
            before = _sizes(plan)
            written = dict.fromkeys(before, 0)
            if apply:
                written["document_id"] = _apply_keys(conn, table, plan, live.collection)
                keyed = _plan(conn, table, live)
                written["superseded_by_id"] = _apply_values(
                    conn, table, "superseded_by_id", keyed.links, live.collection
                )
                written["revision_suggestion"] = _apply_values(
                    conn, table, "revision_suggestion", keyed.suggestions, live.collection
                )
                plan = _plan(conn, table, live)
            after = _sizes(plan)
            counts.extend(
                StoreCount(
                    f"{table}.{column}",
                    before=before[column],
                    written=written[column],
                    after=after[column],
                    unmatched=plan.unmatched.get(column, 0),
                )
                for column in before
            )
    return counts


def collections_to_rekey(store) -> list[str]:
    from sqlalchemy import text

    pending = (
        "document_id IS NULL OR (superseded_by IS NOT NULL AND superseded_by_id IS NULL) "
        "OR (revision_suggestion IS NOT NULL AND (revision_suggestion NOT LIKE '%\"of_id\"%' "
        'OR (revision_suggestion LIKE \'%"dismissed_of": ["%\' '
        "AND revision_suggestion NOT LIKE '%\"dismissed_of_ids\"%')))"
    )
    with store._sync_engine.connect() as conn:
        rows = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT collection FROM {TABLE_NAME} WHERE {pending} "
                f"UNION SELECT collection FROM {RETAINED_TABLE_NAME} WHERE {pending} ORDER BY collection"
            )
        )
        return [row[0] for row in rows]


def rekey_document_ids(
    store, collections: Iterable[str], fetch: Callable[[str], LiveDocuments], *, apply: bool
) -> list[StoreCount]:
    with store._sync_engine.begin() as conn:
        keys = len(name_primary_keys(conn))
        dropped = drop_name_primary_keys(conn) if apply else 0
    with store._sync_engine.connect() as conn:
        left = len(name_primary_keys(conn))
    totals = {PRIMARY_KEY_STORE: StoreCount(PRIMARY_KEY_STORE, before=keys, written=dropped, after=left)}
    for collection in collections:
        for count in rekey_collection(store, fetch(collection), apply=apply):
            total = totals.setdefault(count.store, StoreCount(count.store))
            total.before += count.before
            total.written += count.written
            total.after += count.after
            total.unmatched += count.unmatched
    return list(totals.values())
