from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal
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


UnmatchedReason = Literal["no_documents_in_collection", "no_holder", "near_name", "ambiguous", "id_taken"]


def _name_key(name: str) -> str:
    return unicodedata.normalize("NFC", name)


def name_match_key(name: str) -> str:
    return unicodedata.normalize("NFC", name).strip().lower()


def _near_key(name: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKC", name).casefold() if char.isalnum())


def _spellings(stored: str) -> list[str]:
    plain = unquote(_TMP_UPLOAD_PREFIX.sub("", stored))
    return list(dict.fromkeys(_name_key(spelling) for spelling in (stored, plain)))


def _split(held_by: Mapping[str, set[str]]) -> tuple[dict[str, str], frozenset[str]]:
    return (
        {name: next(iter(held)) for name, held in held_by.items() if len(held) == 1},
        frozenset(name for name, held in held_by.items() if len(held) > 1),
    )


@dataclass(frozen=True)
class NameMatch:
    document_id: str | None
    reason: UnmatchedReason | None = None
    by_key: bool = False


@dataclass(frozen=True)
class Unmatched:
    scope: str
    reason: UnmatchedReason
    count: int


@dataclass(frozen=True)
class LiveDocuments:
    collection: str
    ids_by_name: Mapping[str, str]
    ambiguous: frozenset[str] = frozenset()
    ids_by_key: Mapping[str, str] = field(default_factory=dict)
    ambiguous_keys: frozenset[str] = frozenset()
    near_keys: frozenset[str] = frozenset()

    @classmethod
    def of(cls, collection: str, documents: Iterable[tuple[str, str]]) -> LiveDocuments:
        by_name: dict[str, set[str]] = {}
        by_key: dict[str, set[str]] = {}
        for document_id, filename in documents:
            by_name.setdefault(_name_key(filename), set()).add(document_id)
            by_key.setdefault(name_match_key(filename), set()).add(document_id)
        ids_by_name, ambiguous = _split(by_name)
        ids_by_key, ambiguous_keys = _split(by_key)
        near_keys = frozenset(filter(None, map(_near_key, by_name)))
        return cls(collection, ids_by_name, ambiguous, ids_by_key, ambiguous_keys, near_keys)

    def match(self, stored: str | None) -> NameMatch:
        if not self.ids_by_name and not self.ambiguous:
            return NameMatch(None, "no_documents_in_collection")
        spellings = _spellings(stored or "")
        for spelling in spellings:
            if spelling in self.ids_by_name:
                return NameMatch(self.ids_by_name[spelling])
        if any(spelling in self.ambiguous for spelling in spellings):
            return NameMatch(None, "ambiguous")
        keys = list(dict.fromkeys(map(name_match_key, spellings)))
        for key in keys:
            if key in self.ids_by_key:
                return NameMatch(self.ids_by_key[key], by_key=True)
        if any(key in self.ambiguous_keys for key in keys):
            return NameMatch(None, "ambiguous")
        if any(_near_key(spelling) in self.near_keys for spelling in spellings if _near_key(spelling)):
            return NameMatch(None, "near_name")
        return NameMatch(None, "no_holder")

    def holds_exactly(self, stored: str) -> bool:
        return _name_key(stored) in self.ids_by_name

    def id_for(self, stored: str | None) -> str | None:
        return self.match(stored).document_id


def unmatched_by_scope(reasons: Mapping[tuple[str, UnmatchedReason], int]) -> list[Unmatched]:
    return [Unmatched(scope, reason, count) for (scope, reason), count in sorted(reasons.items()) if count]


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
    unmatched_scopes: list[Unmatched] = field(default_factory=list)


@dataclass
class _Plan:
    keys: list[tuple[str, str]] = field(default_factory=list)
    links: list[tuple[str, str | None, str]] = field(default_factory=list)
    suggestions: list[tuple[str, str | None, str]] = field(default_factory=list)
    unmatched: dict[str, int] = field(default_factory=lambda: {"document_id": 0, "superseded_by_id": 0})
    reasons: dict[str, Counter[UnmatchedReason]] = field(default_factory=dict)

    def leave(self, column: str, reason: UnmatchedReason | None) -> None:
        self.unmatched[column] += 1
        self.reasons.setdefault(column, Counter())[reason or "no_holder"] += 1

    def unmatched_in(self, collection: str, column: str) -> list[Unmatched]:
        return unmatched_by_scope({(collection, reason): n for reason, n in self.reasons.get(column, {}).items()})


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
    matches = {row[0]: live.match(row[0]) for row in rows if not row[1]}
    key_claims = Counter(found.document_id for found in matches.values() if found.by_key)
    for filename in sorted(matches, key=lambda name: (_rank(name, matches[name], live), name)):
        found = matches[filename]
        if found.document_id is None:
            plan.leave("document_id", found.reason)
        elif found.document_id in held or key_claims[found.document_id] > 1:
            plan.leave("document_id", "id_taken")
        else:
            held.add(found.document_id)
            plan.keys.append((filename, found.document_id))
    for row in rows:
        _plan_links(plan, row, live)
    return plan


def _rank(name: str, found: NameMatch, live: LiveDocuments) -> int:
    if live.holds_exactly(name):
        return 0
    return 2 if found.by_key else 1


def _plan_links(plan: _Plan, row, live: LiveDocuments) -> None:
    filename, document_id, superseded_by, superseded_by_id, suggestion = row
    if superseded_by and not superseded_by_id:
        newer = live.match(superseded_by)
        if newer.document_id:
            plan.links.append((filename, document_id, newer.document_id))
        else:
            plan.leave("superseded_by_id", newer.reason)
    keyed = _with_ids(suggestion, live)
    if keyed is not None:
        plan.suggestions.append((filename, document_id, keyed))


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
            counts.extend(_rekey_table(conn, table, live, apply=apply))
    return counts


def _rekey_table(conn, table: str, live: LiveDocuments, *, apply: bool) -> list[StoreCount]:
    plan = _plan(conn, table, live)
    before = _sizes(plan)
    written = dict.fromkeys(before, 0)
    if apply:
        written["document_id"] = _apply_keys(conn, table, plan, live.collection)
        keyed = _plan(conn, table, live)
        written["superseded_by_id"] = _apply_values(conn, table, "superseded_by_id", keyed.links, live.collection)
        written["revision_suggestion"] = _apply_values(
            conn, table, "revision_suggestion", keyed.suggestions, live.collection
        )
        plan = _plan(conn, table, live)
    after = _sizes(plan)
    return [
        StoreCount(
            f"{table}.{column}",
            before=before[column],
            written=written[column],
            after=after[column],
            unmatched=plan.unmatched.get(column, 0),
            unmatched_scopes=plan.unmatched_in(live.collection, column),
        )
        for column in before
    ]


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
            total.unmatched_scopes.extend(count.unmatched_scopes)
    return list(totals.values())
