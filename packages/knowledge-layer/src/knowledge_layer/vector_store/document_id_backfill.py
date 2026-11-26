# drop after release 2026-W50: copies grid_document_id to document_id where only the old key is set

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models

from agent.knowledge.document_metadata_rekey import LiveDocuments

from .legacy_names import LEGACY_DOCUMENT_ID_FIELD
from .schema import DOCUMENT_ID_FIELD
from .schema import FOLDER_KIND
from .schema import KIND_FIELD
from .schema import SCOPE_FIELD
from .scope import is_tenant_scope

logger = logging.getLogger(__name__)


def _empty(key: str) -> models.IsEmptyCondition:
    return models.IsEmptyCondition(is_empty=models.PayloadField(key=key))


ONLY_OLD_KEY = models.Filter(must=[_empty(DOCUMENT_ID_FIELD)], must_not=[_empty(LEGACY_DOCUMENT_ID_FIELD)])
BOTH_KEYS = models.Filter(must_not=[_empty(DOCUMENT_ID_FIELD), _empty(LEGACY_DOCUMENT_ID_FIELD)])


@dataclass(frozen=True)
class BackfillCount:
    before: int
    written: int
    after: int


def only_old_document_id(client: QdrantClient, collection: str) -> int:
    return client.count(collection, count_filter=ONLY_OLD_KEY, exact=True).count


def document_id_mismatches(client: QdrantClient, collection: str, *, page_size: int) -> int:
    disagree = 0
    offset: Any = None
    while True:
        points, offset = client.scroll(
            collection,
            scroll_filter=BOTH_KEYS,
            limit=page_size,
            offset=offset,
            with_payload=[DOCUMENT_ID_FIELD, LEGACY_DOCUMENT_ID_FIELD],
            with_vectors=False,
        )
        disagree += sum(
            1
            for point in points
            if (point.payload or {}).get(DOCUMENT_ID_FIELD) != (point.payload or {}).get(LEGACY_DOCUMENT_ID_FIELD)
        )
        if offset is None:
            return disagree


def backfill_document_ids(client: QdrantClient, collection: str, *, apply: bool, page_size: int) -> BackfillCount:
    before = only_old_document_id(client, collection)
    if not apply:
        return BackfillCount(before=before, written=0, after=before)
    written = 0
    while True:
        points, _ = client.scroll(
            collection,
            scroll_filter=ONLY_OLD_KEY,
            limit=page_size,
            with_payload=[LEGACY_DOCUMENT_ID_FIELD],
            with_vectors=False,
        )
        if not points:
            break
        by_value: dict[str, list[Any]] = {}
        for point in points:
            by_value.setdefault(str((point.payload or {})[LEGACY_DOCUMENT_ID_FIELD]), []).append(point.id)
        client.batch_update_points(
            collection,
            update_operations=[
                models.SetPayloadOperation(
                    set_payload=models.SetPayload(payload={DOCUMENT_ID_FIELD: value}, points=ids)
                )
                for value, ids in by_value.items()
            ],
            wait=True,
        )
        written += len(points)
        logger.info("%s: %d points given %s", collection, written, DOCUMENT_ID_FIELD)
    return BackfillCount(before=before, written=written, after=only_old_document_id(client, collection))


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
        for point in points:
            payload = point.payload or {}
            scope, file_name = payload.get(SCOPE_FIELD), payload.get("file_name")
            if isinstance(scope, str) and isinstance(file_name, str) and file_name and is_tenant_scope(scope):
                found[(scope, file_name)] = found.get((scope, file_name), 0) + 1
        if offset is None:
            return found


def _matched(
    files: dict[tuple[str, str], int], live: Callable[[str], LiveDocuments]
) -> tuple[dict[tuple[str, str], str], int]:
    matched: dict[tuple[str, str], str] = {}
    unmatched = 0
    for (scope, file_name), points in files.items():
        document_id = live(scope).id_for(file_name)
        if document_id:
            matched[(scope, file_name)] = document_id
        else:
            unmatched += points
    return matched, unmatched


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
    matched, unmatched = _matched(files, live)
    before = sum(files[key] for key in matched)
    scopes = len({scope for scope, _ in files})
    if not apply:
        return StampCount(before=before, written=0, after=before, unmatched=unmatched, scopes=scopes)
    operations = [
        models.SetPayloadOperation(
            set_payload=models.SetPayload(payload={DOCUMENT_ID_FIELD: document_id}, filter=_stamp_filter(*key))
        )
        for key, document_id in matched.items()
    ]
    for start in range(0, len(operations), STAMP_BATCH):
        client.batch_update_points(collection, update_operations=operations[start : start + STAMP_BATCH], wait=True)
        logger.info("%s: %d of %d files given %s", collection, start + STAMP_BATCH, len(operations), DOCUMENT_ID_FIELD)
    left = _unstamped_files(client, collection, page_size=page_size)
    left_matched, left_unmatched = _matched(left, live)
    after = sum(left[key] for key in left_matched)
    return StampCount(before=before, written=before - after, after=after, unmatched=left_unmatched, scopes=scopes)
