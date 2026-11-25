from __future__ import annotations

import logging

from qdrant_client import models

from agent.common.source_kinds import LEGACY_BASE_CORPUS_COLLECTION as LEGACY_BASE_CORPUS_SCOPE

from .schema import BASE_CORPUS_SCOPE
from .schema import SCOPE_FIELD
from .store import QdrantStore
from .store import with_retry

logger = logging.getLogger(__name__)

_LEGACY = models.Filter(
    must=[models.FieldCondition(key=SCOPE_FIELD, match=models.MatchValue(value=LEGACY_BASE_CORPUS_SCOPE))]
)


def move_legacy_base_corpus(store: QdrantStore) -> int:
    if not store.exists(BASE_CORPUS_SCOPE):
        return 0
    alias = store.alias(BASE_CORPUS_SCOPE)
    legacy = store.client.count(alias, count_filter=_LEGACY, exact=True).count
    if not legacy:
        return 0
    with_retry(
        f"move {LEGACY_BASE_CORPUS_SCOPE} to {BASE_CORPUS_SCOPE}",
        lambda: store.client.set_payload(
            alias, payload={SCOPE_FIELD: BASE_CORPUS_SCOPE}, points=models.FilterSelector(filter=_LEGACY), wait=True
        ),
    )
    left = store.client.count(alias, count_filter=_LEGACY, exact=True).count
    if left:
        raise RuntimeError(f"{left} base-corpus points still carry scope {LEGACY_BASE_CORPUS_SCOPE!r}")
    logger.info("Moved %d base-corpus points from %s to %s", legacy, LEGACY_BASE_CORPUS_SCOPE, BASE_CORPUS_SCOPE)
    return legacy
