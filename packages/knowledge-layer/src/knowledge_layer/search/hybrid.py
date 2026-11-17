from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

RRF_K = 60

try:
    from agent.common.legal_terms import extract_exact_terms  # type: ignore
except ImportError:  # knowledge_layer usable without the agent package
    extract_exact_terms = None  # type: ignore


def fuse_with_ranks(
    channels: list[list[Any]],
    *,
    k: int = RRF_K,
    top_n: int | None = None,
) -> list[tuple[Any, int, float]]:
    scores: dict[str, float] = {}
    best: dict[str, Any] = {}
    best_rank: dict[str, int] = {}

    for channel in channels:
        for rank, chunk in enumerate(channel):
            chunk_id = getattr(chunk, "chunk_id", None)
            if not chunk_id:
                continue
            if chunk_id not in best:
                best[chunk_id] = chunk
                best_rank[chunk_id] = rank
            elif rank < best_rank[chunk_id]:
                best_rank[chunk_id] = rank
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)

    ordered = sorted(scores, key=lambda cid: (scores[cid], -best_rank[cid]), reverse=True)
    if top_n is not None:
        ordered = ordered[:top_n]
    return [(best[cid], fused_rank, scores[cid]) for fused_rank, cid in enumerate(ordered)]


def reciprocal_rank_fusion(
    channels: list[list[Any]],
    *,
    k: int = RRF_K,
    top_n: int | None = None,
) -> list[Any]:
    return [chunk for chunk, _fused_rank, _fused_score in fuse_with_ranks(channels, k=k, top_n=top_n)]


try:
    from agent.common.german_text import DEFAULT_DF_CEILING_MIN_TOTAL  # type: ignore
    from agent.common.german_text import DEFAULT_DF_CEILING_RATIO  # type: ignore
except ImportError:  # knowledge_layer usable without the agent package
    DEFAULT_DF_CEILING_RATIO = 0.25  # type: ignore[assignment]
    DEFAULT_DF_CEILING_MIN_TOTAL = 25  # type: ignore[assignment]


def selective_terms(
    frequencies: dict[str, int],
    total: int,
    *,
    df_ceiling_ratio: float = DEFAULT_DF_CEILING_RATIO,
    min_total: int = DEFAULT_DF_CEILING_MIN_TOTAL,
) -> list[str]:
    if not frequencies or total <= 0:
        return []
    apply_ceiling = total >= min_total
    ceiling = total * df_ceiling_ratio
    kept: list[str] = []
    for term, frequency in frequencies.items():
        if frequency <= 0:
            continue
        if apply_ceiling and frequency > ceiling:
            logger.info(
                "Exact term %r dropped: on %d of %d chunks (%.1f%%), above the %.0f%% ceiling",
                term,
                frequency,
                total,
                100.0 * frequency / total,
                100.0 * df_ceiling_ratio,
            )
            continue
        kept.append(term)
    return kept
