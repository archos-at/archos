"""Copy ``grid_document_id`` to ``document_id`` where only the old key is set: drop after release 2026-W50."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models

from .legacy_names import LEGACY_DOCUMENT_ID_FIELD
from .schema import DOCUMENT_ID_FIELD

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
