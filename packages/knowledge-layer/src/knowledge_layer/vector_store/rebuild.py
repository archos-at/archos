from __future__ import annotations

import logging
import math
import statistics
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models

from .schema import ALIASES
from .schema import BM25_DEFAULT_LENGTH
from .schema import DENSE
from .schema import LEXICAL
from .schema import TEXT_FIELD
from .schema import TEXT_STEM_FIELD
from .schema import Physical
from .schema import bm25_length_of
from .schema import create_collection
from .schema import effective_bm25_length
from .store import bm25
from .store import with_retry

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 256
LENGTH_SAMPLE = 5000
AVG_LEN_TOLERANCE = 0.10


@dataclass
class RebuildReport:
    source: str
    target: str
    copied: int
    source_count: int
    target_count: int
    bm25_length: dict[str, float] | None = None
    relexed: bool = False

    @property
    def complete(self) -> bool:
        return self.source_count == self.target_count


def current_collection(client: QdrantClient, physical: Physical) -> str:
    alias = ALIASES[physical]
    for entry in client.get_aliases().aliases:
        if entry.alias_name == alias:
            return entry.collection_name
    raise RuntimeError(f"alias {alias} does not exist")


def _exact_count(client: QdrantClient, name: str) -> int:
    return client.count(name, exact=True).count


def length_from_weight(weight: float, length: Mapping[str, float]) -> float | None:
    k, b, avg_len = (length[key] for key in ("k", "b", "avg_len"))
    if weight <= 0 or b <= 0:
        return None
    dl = (((k + 1) / weight - 1) / k - (1 - b)) * avg_len / b
    return dl if dl >= 0 else None


@dataclass(frozen=True)
class LengthStats:
    collection: str
    sampled: int
    mean: float
    p50: float
    p90: float

    def line(self) -> str:
        return f"{self.collection}: {self.sampled} chunks, mean {self.mean:.0f}, p50 {self.p50:.0f}, p90 {self.p90:.0f}"


def measure_lengths(client: QdrantClient, collection: str, sample: int = LENGTH_SAMPLE) -> LengthStats | None:
    length = effective_bm25_length(bm25_length_of(client.get_collection(collection).config.metadata))
    found: list[float] = []
    offset = None
    while len(found) < sample:
        page, offset = client.scroll(
            collection, limit=min(DEFAULT_PAGE_SIZE, sample - len(found)), offset=offset, with_vectors=[LEXICAL]
        )
        for record in page:
            sparse = (record.vector or {}).get(LEXICAL) if isinstance(record.vector, dict) else None
            values = getattr(sparse, "values", None)
            dl = length_from_weight(min(values), length) if values else None
            if dl is not None:
                found.append(dl)
        if offset is None:
            break
    if not found:
        return None
    ordered = sorted(found)
    return LengthStats(
        collection,
        len(ordered),
        statistics.fmean(ordered),
        ordered[len(ordered) // 2],
        ordered[min(len(ordered) - 1, math.ceil(0.9 * len(ordered)) - 1)],
    )


def tuned_length(
    measured: LengthStats | None,
    source: Mapping[str, float],
    *,
    k: float | None = None,
    b: float | None = None,
    avg_len: float | None = None,
) -> dict[str, float]:
    current = effective_bm25_length(dict(source))
    wanted = dict(current)
    if avg_len is not None:
        wanted["avg_len"] = float(avg_len)
    elif measured is not None and abs(measured.mean - current["avg_len"]) > AVG_LEN_TOLERANCE * current["avg_len"]:
        wanted["avg_len"] = float(round(measured.mean))
    if k is not None:
        wanted["k"] = float(k)
    if b is not None:
        wanted["b"] = float(b)
    return wanted


def _copied_payload(record: Any) -> dict[str, Any]:
    payload = dict(record.payload or {})
    if TEXT_FIELD in payload and TEXT_STEM_FIELD not in payload:
        payload[TEXT_STEM_FIELD] = payload[TEXT_FIELD]
    return payload


def _copied_vector(record: Any, relex: Mapping[str, float] | None) -> Any:
    if relex is None:
        return record.vector
    vector: dict[str, Any] = {DENSE: record.vector[DENSE]}
    text = str((record.payload or {}).get(TEXT_FIELD) or "")
    if text.strip():
        vector[LEXICAL] = bm25(text, relex)
    return vector


def copy_collection(
    client: QdrantClient,
    physical: Physical,
    target: str,
    *,
    shards: int | None = None,
    replication: int | None = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    bm25_length: Mapping[str, float] | None = None,
    retune_bm25: bool = True,
) -> RebuildReport:
    source = current_collection(client, physical)
    if target == source:
        raise ValueError(f"{target} is the live collection behind {ALIASES[physical]}")
    if client.collection_exists(target):
        raise RuntimeError(f"{target} already exists: drop it, or rebuild into the next _vN")
    info = client.get_collection(source)
    params = info.config.params
    identity = dict(info.config.metadata or {})
    source_length = bm25_length_of(identity)
    if bm25_length is not None:
        target_length = effective_bm25_length(dict(bm25_length))
    elif retune_bm25:
        target_length = tuned_length(measure_lengths(client, source), source_length)
    else:
        target_length = effective_bm25_length(source_length)
    relex = target_length if target_length != effective_bm25_length(source_length) else None
    recorded = None if target_length == BM25_DEFAULT_LENGTH else target_length
    create_collection(
        client,
        physical,
        target,
        params.vectors[DENSE].size,
        identity,
        shards=shards or params.shard_number,
        replication=replication or params.replication_factor,
        bm25_length=recorded,
    )
    if relex is not None:
        logger.info("BM25 length %s -> %s: every lexical vector is recomputed", source_length or "default", relex)
    copied = 0
    offset = None
    while True:
        page, offset = client.scroll(source, limit=page_size, offset=offset, with_payload=True, with_vectors=True)
        if page:
            points = [
                models.PointStruct(id=record.id, vector=_copied_vector(record, relex), payload=_copied_payload(record))
                for record in page
            ]
            with_retry(f"copy into {target}", lambda: client.upsert(target, points, wait=True))
            copied += len(page)
        if offset is None:
            break
    report = RebuildReport(
        source,
        target,
        copied,
        _exact_count(client, source),
        _exact_count(client, target),
        bm25_length=target_length,
        relexed=relex is not None,
    )
    logger.info(
        "Copied %d points %s -> %s (%d vs %d)", copied, source, target, report.source_count, report.target_count
    )
    return report


def switch_alias(client: QdrantClient, physical: Physical, target: str) -> str:
    alias = ALIASES[physical]
    previous = current_collection(client, physical)
    if not client.collection_exists(target):
        raise RuntimeError(f"{target} does not exist")
    client.update_collection_aliases(
        change_aliases_operations=[
            models.DeleteAliasOperation(delete_alias=models.DeleteAlias(alias_name=alias)),
            models.CreateAliasOperation(create_alias=models.CreateAlias(collection_name=target, alias_name=alias)),
        ]
    )
    logger.info("Alias %s: %s -> %s", alias, previous, target)
    return previous
