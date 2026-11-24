from __future__ import annotations

import logging
from collections.abc import Callable
from collections.abc import Sequence
from typing import Any

from qdrant_client import models

from agent.knowledge.base import DocumentPosition
from agent.knowledge.base import document_position
from agent.knowledge.base import reading_order

from .reading_office import office_read
from .schema import CHUNK_ID_FIELD
from .schema import READING_ORDER_FIELD
from .schema import TEXT_FIELD
from .search import Hit
from .store import QdrantStore
from .store import get_store

logger = logging.getLogger(__name__)

WHOLE_SET_CAP = 4096


def fetch(scope: str, filters: dict[str, Any] | None, limit: int, order_by: str | None = None) -> list[Hit]:
    if order_by not in (None, READING_ORDER_FIELD):
        raise ValueError(f"A structural fetch orders by {READING_ORDER_FIELD!r} only, not {order_by!r}")
    office = office_read(scope)
    store = get_store()
    if limit <= 0 or not store.exists(scope):
        return []
    if order_by is None:
        records = list(store.scroll(scope, filters, *office, limit=limit))
    elif _orders_server_side(store, scope, filters, office):
        records = _ordered_by_server(store, scope, filters, limit, office)
    else:
        records = _ordered_here(store, scope, filters, limit, office)
    return [_hit(record) for record in records]


def fetch_from(scope: str, filters: dict[str, Any] | None, start: DocumentPosition, limit: int) -> list[Hit]:
    office = office_read(scope)
    store = get_store()
    if limit <= 0 or not store.exists(scope):
        return []
    if _orders_server_side(store, scope, filters, office):
        bound = {READING_ORDER_FIELD: {"$gte": start[0]}}
        both = {"$and": [filters, bound]} if filters else bound
        records = list(store.scroll(scope, both, *office, limit=WHOLE_SET_CAP))
    else:
        records = list(store.scroll(scope, filters, *office, limit=WHOLE_SET_CAP))
    _warn_if_capped(records, scope)
    start = tuple(start)
    after = [hit for hit in in_document_order([_hit(record) for record in records]) if _document_key(hit) > start]
    return after[:limit]


def in_document_order(hits: Sequence[Hit]) -> list[Hit]:
    return sorted(hits, key=_document_key)


def _document_key(hit: Hit) -> DocumentPosition:
    return document_position(hit.payload, hit.chunk_id)


Office = Sequence[models.Filter]


def _orders_server_side(store: QdrantStore, scope: str, filters: dict[str, Any] | None, office: Office) -> bool:
    if not store.has_index(scope, READING_ORDER_FIELD):
        return False
    missing = models.IsEmptyCondition(is_empty=models.PayloadField(key=READING_ORDER_FIELD))
    return store.count(scope, filters, missing, *office) == 0


def _ordered_by_server(
    store: QdrantStore, scope: str, filters: dict[str, Any] | None, limit: int, office: Office
) -> list[Any]:
    page = store.scroll_ordered(scope, filters, READING_ORDER_FIELD, limit, *office)
    if len(page) < limit:
        return page
    boundary = _stored_order(page[-1])
    tie = {READING_ORDER_FIELD: boundary}
    tied = list(store.scroll(scope, {"$and": [filters, tie]} if filters else tie, *office, limit=WHOLE_SET_CAP))
    _warn_if_capped(tied, scope)
    return [record for record in page if _stored_order(record) < boundary] + tied


def _ordered_here(
    store: QdrantStore, scope: str, filters: dict[str, Any] | None, limit: int, office: Office
) -> list[Any]:
    records = list(store.scroll(scope, filters, *office, limit=WHOLE_SET_CAP))
    _warn_if_capped(records, scope)
    records.sort(key=_derived_order)
    return _first_with_ties(records, limit, _derived_order)


def _first_with_ties(ordered: Sequence[Any], limit: int, key: Callable[[Any], int]) -> list[Any]:
    if len(ordered) <= limit:
        return list(ordered)
    boundary = key(ordered[limit - 1])
    return [item for item in ordered if key(item) <= boundary]


def _stored_order(record: Any) -> int:
    return int((record.payload or {})[READING_ORDER_FIELD])


def _derived_order(record: Any) -> int:
    return reading_order((record.payload or {}).get("page_label"))


def _warn_if_capped(records: Sequence[Any], scope: str) -> None:
    if len(records) >= WHOLE_SET_CAP:
        logger.warning(
            "Structural fetch in %s hit the %d-chunk cap; its order past the cap is not kept", scope, WHOLE_SET_CAP
        )


def _hit(record: Any) -> Hit:
    payload = dict(record.payload or {})
    return Hit(str(payload.get(CHUNK_ID_FIELD) or record.id), str(payload.get(TEXT_FIELD) or ""), payload, 0.0, 1.0)
