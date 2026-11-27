# drop after release 2027-W02: gives a user document's points with neither id key the id of its document

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models

from agent.knowledge.document_metadata_rekey import LiveDocuments
from agent.knowledge.document_metadata_rekey import NameMatch
from agent.knowledge.document_metadata_rekey import Unmatched
from agent.knowledge.document_metadata_rekey import UnmatchedReason
from agent.knowledge.document_metadata_rekey import unmatched_by_scope

from .legacy_names import LEGACY_DOCUMENT_ID_FIELD
from .schema import DOCUMENT_ID_FIELD
from .schema import FOLDER_KIND
from .schema import KIND_FIELD
from .schema import SCOPE_FIELD
from .scope import is_tenant_scope

logger = logging.getLogger(__name__)


def _empty(key: str) -> models.IsEmptyCondition:
    return models.IsEmptyCondition(is_empty=models.PayloadField(key=key))


NEITHER_KEY = models.Filter(
    must=[_empty(DOCUMENT_ID_FIELD), _empty(LEGACY_DOCUMENT_ID_FIELD)],
    must_not=[models.FieldCondition(key=KIND_FIELD, match=models.MatchValue(value=FOLDER_KIND))],
)
STAMP_BATCH = 100


@dataclass(frozen=True)
class StampCount:
    before: int
    written: int
    after: int
    unmatched: int
    scopes: int
    unmatched_held: int = 0
    unmatched_scopes: tuple[Unmatched, ...] = ()


@dataclass(frozen=True)
class _Match:
    ids: dict[tuple[str, str], str]
    unmatched: int
    held: int
    reasons: tuple[Unmatched, ...]


def _unstamped_files(client: QdrantClient, collection: str, *, page_size: int) -> dict[tuple[str, str], int]:
    found: dict[tuple[str, str], int] = {}
    offset: Any = None
    while True:
        points, offset = client.scroll(
            collection,
            scroll_filter=NEITHER_KEY,
            limit=page_size,
            offset=offset,
            with_payload=[SCOPE_FIELD, "file_name"],
            with_vectors=False,
        )
        for key in filter(None, map(_tenant_file, points)):
            found[key] = found.get(key, 0) + 1
        if offset is None:
            return found


def _tenant_file(point: Any) -> tuple[str, str] | None:
    payload = point.payload or {}
    scope, file_name = payload.get(SCOPE_FIELD), payload.get("file_name")
    if isinstance(scope, str) and isinstance(file_name, str) and file_name and is_tenant_scope(scope):
        return (scope, file_name)
    return None


def _id_condition(document_id: str) -> models.Filter:
    return models.Filter(
        should=[
            models.FieldCondition(key=key, match=models.MatchValue(value=document_id))
            for key in (DOCUMENT_ID_FIELD, LEGACY_DOCUMENT_ID_FIELD)
        ]
    )


def _has_points_of(client: QdrantClient, collection: str, scope: str, document_id: str) -> bool:
    scoped = models.Filter(
        must=[models.FieldCondition(key=SCOPE_FIELD, match=models.MatchValue(value=scope)), _id_condition(document_id)]
    )
    return client.count(collection, count_filter=scoped, exact=True).count > 0


def _matched(
    client: QdrantClient,
    collection: str,
    files: dict[tuple[str, str], int],
    live: Callable[[str], LiveDocuments],
) -> _Match:
    found = {key: live(key[0]).match(key[1]) for key in files}
    by_spelling = {(scope, match.document_id) for (scope, _), match in found.items() if not match.by_key}
    by_key = Counter((scope, match.document_id) for (scope, _), match in found.items() if match.by_key)

    def reason_left(scope: str, match: NameMatch) -> UnmatchedReason | None:
        if not (match.document_id and match.by_key):
            return match.reason
        claimed = (scope, match.document_id) in by_spelling or by_key[(scope, match.document_id)] > 1
        return "id_taken" if claimed or _has_points_of(client, collection, scope, match.document_id) else None

    ids: dict[tuple[str, str], str] = {}
    reasons: Counter[tuple[str, UnmatchedReason]] = Counter()
    held = 0
    for (scope, file_name), match in found.items():
        reason = reason_left(scope, match)
        if match.document_id and reason is None:
            ids[(scope, file_name)] = match.document_id
        else:
            reasons[(scope, reason or "no_holder")] += files[(scope, file_name)]
            held += files[(scope, file_name)] if match.held else 0
    return _Match(ids, sum(reasons.values()), held, tuple(unmatched_by_scope(reasons)))


def _stamp_filter(scope: str, file_name: str) -> models.Filter:
    return models.Filter(
        must=[
            models.FieldCondition(key=SCOPE_FIELD, match=models.MatchValue(value=scope)),
            models.FieldCondition(key="file_name", match=models.MatchValue(value=file_name)),
            NEITHER_KEY,
        ]
    )


def stamp_document_ids(
    client: QdrantClient,
    collection: str,
    fetch: Callable[[str], LiveDocuments],
    *,
    apply: bool,
    page_size: int,
) -> StampCount:
    cache: dict[str, LiveDocuments] = {}

    def live(scope: str) -> LiveDocuments:
        if scope not in cache:
            cache[scope] = fetch(scope)
        return cache[scope]

    files = _unstamped_files(client, collection, page_size=page_size)
    found = _matched(client, collection, files, live)
    before = sum(files[key] for key in found.ids)
    scopes = len({scope for scope, _ in files})
    if not apply:
        return StampCount(before, 0, before, found.unmatched, scopes, found.held, found.reasons)
    operations = [
        models.SetPayloadOperation(
            set_payload=models.SetPayload(payload={DOCUMENT_ID_FIELD: document_id}, filter=_stamp_filter(*key))
        )
        for key, document_id in found.ids.items()
    ]
    for start in range(0, len(operations), STAMP_BATCH):
        client.batch_update_points(collection, update_operations=operations[start : start + STAMP_BATCH], wait=True)
        logger.info("%s: %d of %d files given %s", collection, start + STAMP_BATCH, len(operations), DOCUMENT_ID_FIELD)
    left = _unstamped_files(client, collection, page_size=page_size)
    remaining = _matched(client, collection, left, live)
    after = sum(left[key] for key in remaining.ids)
    return StampCount(before, before - after, after, remaining.unmatched, scopes, remaining.held, remaining.reasons)
