from __future__ import annotations

import logging
from collections.abc import Iterable
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from agent.common.grounding_block import GroundingHit

logger = logging.getLogger(__name__)

ARTIFACT_KEY = "citations"

_collector: ContextVar[list[GroundingHit] | None] = ContextVar("citation_hits", default=None)


@contextmanager
def collect_citations() -> Iterator[list[GroundingHit]]:
    collected: list[GroundingHit] = []
    token = _collector.set(collected)
    try:
        yield collected
    finally:
        _collector.reset(token)


def note_citations(hits: Iterable[GroundingHit]) -> None:
    collected = _collector.get()
    if collected is not None:
        collected.extend(hits)


def artifact_for(hits: Iterable[GroundingHit]) -> dict[str, Any] | None:
    dumped = [hit.model_dump(mode="json") for hit in hits]
    return {ARTIFACT_KEY: dumped} if dumped else None


def hits_from_artifact(artifact: Any) -> list[GroundingHit] | None:
    if not isinstance(artifact, dict):
        return None
    raw = artifact.get(ARTIFACT_KEY)
    if not isinstance(raw, list) or not raw:
        return None
    hits: list[GroundingHit] = []
    for item in raw:
        try:
            hits.append(item if isinstance(item, GroundingHit) else GroundingHit.model_validate(item))
        except Exception:  # noqa: BLE001 - a record that does not validate is dropped, the text path remains
            logger.warning("A citation record on a tool result did not validate", exc_info=True)
    return hits or None
