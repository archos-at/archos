from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import replace
from typing import Any
from typing import Literal

from qdrant_client import models

from .boost import Boost
from .boost import boosted
from .boost import ranking_formula
from .payload import paragraph_key
from .schema import DENSE
from .schema import LEXICAL
from .schema import PARAGRAPH_FIELD
from .schema import TEXT_FIELD
from .schema import physical_for_scope
from .scope import ScopeRead
from .scope import scope_filter
from .store import QdrantStore
from .store import bm25

RRF_K = 60


@dataclass(frozen=True)
class Ranking:

    fusion: Literal["rrf", "dbsf"] = "rrf"
    rrf_k: int = RRF_K
    dense_weight: float = 1.0
    rescore: bool = False
    oversampling: float | None = None
    mmr_diversity: float | None = None
    mmr_candidates: int | None = None
    cosine_tie_break: bool = True

    def label(self) -> str:
        parts = [f"rrf{self.rrf_k}" if self.fusion == "rrf" else self.fusion]
        if self.dense_weight != 1.0:
            parts.append(f"dense_w{self.dense_weight:g}")
        if self.rescore:
            parts.append("rescore" + ("" if self.oversampling is None else f"_os{self.oversampling:g}"))
        elif self.oversampling is not None:
            parts.append(f"os{self.oversampling:g}")
        if self.mmr_diversity is not None:
            parts.append(f"mmr{self.mmr_diversity:g}" + (f"_c{self.mmr_candidates}" if self.mmr_candidates else ""))
        if self.cosine_tie_break:
            parts.append("cosine_ties")
        return "+".join(parts)


RANKING = Ranking()


@dataclass
class Hit:

    chunk_id: str
    text: str
    payload: dict[str, Any]
    fused: float
    cosine: float
    lexical: bool = False


def phrase(term: str) -> models.FieldCondition:
    return models.FieldCondition(key=TEXT_FIELD, match=models.MatchPhrase(phrase=term))


_PARAGRAPH_TERM = re.compile(r"^§\s*(\S+)$")


def exact_term(term: str) -> models.FieldCondition:
    paragraph = _PARAGRAPH_TERM.match(term.strip())
    if paragraph:
        return models.FieldCondition(key=PARAGRAPH_FIELD, match=models.MatchValue(value=paragraph_key(paragraph[1])))
    return phrase(term)


def _alias(store: QdrantStore, scopes: Sequence[str]) -> str:
    physicals = {physical_for_scope(scope) for scope in scopes}
    if len(physicals) != 1:
        raise ValueError(f"One search reads one physical collection; scopes {list(scopes)!r} span {physicals}")
    return store.alias(scopes[0])


def _opened(store: QdrantStore, scopes: Sequence[str], office_id: str | None) -> tuple[ScopeRead, str] | None:
    read = ScopeRead(tuple(scopes), office_id)
    if not scopes or not store.exists(scopes[0]):
        return None
    return read, _alias(store, scopes)


def _dense_params(ranking: Ranking) -> models.SearchParams | None:
    if not ranking.rescore and ranking.oversampling is None:
        return None
    return models.SearchParams(
        quantization=models.QuantizationSearchParams(rescore=ranking.rescore, oversampling=ranking.oversampling)
    )


def _dense_query(vector: Sequence[float], ranking: Ranking) -> Any:
    if ranking.mmr_diversity is None:
        return list(vector)
    mmr = models.Mmr(diversity=ranking.mmr_diversity, candidates_limit=ranking.mmr_candidates)
    return models.NearestQuery(nearest=list(vector), mmr=mmr)


def _prefetches(
    scopes: Sequence[str],
    query_filter: models.Filter,
    vector: Sequence[float],
    lexical_text: str,
    exact_terms: Sequence[str],
    candidates: int,
    ranking: Ranking,
    length: dict[str, float] | None = None,
) -> list[models.Prefetch]:
    idf = models.SearchParams(idf=models.IdfCorpusParams(corpus=scope_filter(scopes)))
    dense = _dense_params(ranking)
    prefetch = [
        models.Prefetch(
            query=_dense_query(vector, ranking), using=DENSE, limit=candidates, filter=query_filter, params=dense
        )
    ]
    if lexical_text.strip():
        prefetch.append(
            models.Prefetch(
                query=bm25(lexical_text, length), using=LEXICAL, limit=candidates, filter=query_filter, params=idf
            )
        )
    for term in exact_terms:
        restricted = models.Filter(must=[query_filter, exact_term(term)])
        prefetch.append(
            models.Prefetch(query=list(vector), using=DENSE, limit=candidates, filter=restricted, params=dense)
        )
    return prefetch


def _fusion(ranking: Ranking, channels: int) -> models.RrfQuery | models.FusionQuery:
    if ranking.fusion == "dbsf":
        return models.FusionQuery(fusion=models.Fusion.DBSF)
    weights = None
    if ranking.dense_weight != 1.0 and channels > 1:
        weights = [ranking.dense_weight] + [1.0] * (channels - 1)
    return models.RrfQuery(rrf=models.Rrf(k=ranking.rrf_k, weights=weights))


def _cosines(
    store: QdrantStore, alias: str, read: ScopeRead, vector: Sequence[float], ids: Sequence[Any]
) -> dict[str, float]:
    if not ids:
        return {}
    result = store.client.query_points(
        alias,
        query=list(vector),
        using=DENSE,
        query_filter=read.filter(None, models.HasIdCondition(has_id=list(ids))),
        search_params=models.SearchParams(exact=True),
        limit=len(ids),
        with_payload=False,
    )
    return {str(point.id): float(point.score) for point in result.points}


def _hit(point: Any, cosines: dict[str, float]) -> Hit:
    payload = dict(point.payload or {})
    return Hit(
        chunk_id=str(payload.get("chunk_id") or point.id),
        text=str(payload.get(TEXT_FIELD) or ""),
        payload=payload,
        fused=float(point.score),
        cosine=cosines.get(str(point.id), 0.0),
    )


def hybrid_search(
    store: QdrantStore,
    scopes: Sequence[str],
    *,
    office_id: str | None,
    vector: Sequence[float],
    lexical_text: str,
    limit: int,
    filters: dict[str, Any] | None = None,
    exact_terms: Sequence[str] = (),
    candidates: int | None = None,
) -> list[Hit]:
    opened = _opened(store, scopes, office_id)
    if opened is None or limit <= 0:
        return []
    read, alias = opened
    query_filter = read.filter(filters)
    formula = ranking_formula(None, _binding_editions())
    prefetch = [
        boosted(channel, formula)
        for channel in _prefetches(
            scopes,
            query_filter,
            vector,
            lexical_text,
            exact_terms,
            candidates or limit,
            RANKING,
            store.bm25_length(scopes[0]),
        )
    ]
    result = store.client.query_points(
        alias,
        prefetch=prefetch,
        query=_fusion(RANKING, len(prefetch)),
        limit=limit + _tie_slack(limit) if RANKING.cosine_tie_break else limit,
        with_payload=True,
    )
    cosines = _cosines(store, alias, read, vector, [point.id for point in result.points])
    hits = [_hit(point, cosines) for point in result.points]
    return _cosine_ordered_ties(hits)[:limit] if RANKING.cosine_tie_break else hits


def _binding_editions() -> frozenset[str]:
    from agent.common.knowledge_context import binding_editions

    return binding_editions()


def _tie_slack(limit: int) -> int:
    return max(4, limit // 4)


def _tie_order(hit: Hit) -> tuple[float, float, str]:
    return (-round(hit.fused, 9), -hit.cosine, hit.chunk_id)


def _cosine_ordered_ties(hits: list[Hit]) -> list[Hit]:
    return sorted(hits, key=_tie_order)


def grouped_search(
    store: QdrantStore,
    scopes: Sequence[str],
    *,
    office_id: str | None,
    vector: Sequence[float],
    lexical_text: str,
    group_by: str,
    groups: int,
    group_size: int,
    filters: dict[str, Any] | None = None,
    boost: Boost | None = None,
    exact_terms: Sequence[str] = (),
    candidates: int = 200,
) -> list[tuple[str, list[Hit]]]:
    opened = _opened(store, scopes, office_id)
    if opened is None or groups <= 0:
        return []
    read, alias = opened
    query_filter = read.filter(filters)
    formula = ranking_formula(boost, _binding_editions())
    prefetch = [
        boosted(channel, formula)
        for channel in _prefetches(
            scopes, query_filter, vector, lexical_text, exact_terms, candidates, RANKING, store.bm25_length(scopes[0])
        )
    ]
    result = store.client.query_points(
        alias,
        prefetch=prefetch,
        query=_fusion(RANKING, len(prefetch)),
        limit=max(candidates, groups * group_size),
        with_payload=True,
    )
    points = list(result.points)
    cosines: dict[str, float] | None = None
    if RANKING.cosine_tie_break:
        cosines = _cosines(store, alias, read, vector, [point.id for point in points])
        points.sort(key=lambda point: _tie_order(_hit(point, cosines)))
    collected = _group_in_order(points, group_by, groups, group_size)
    kept = [point.id for group in collected.values() for point in group]
    if cosines is None:
        cosines = _cosines(store, alias, read, vector, kept)
    lexical = _lexical_ids(store, alias, scopes, query_filter, vector, lexical_text, exact_terms, kept)
    return [(key, _stated(group, cosines, lexical)) for key, group in collected.items()]


def _stated(points: Sequence[Any], cosines: dict[str, float], lexical: set[str]) -> list[Hit]:
    return [replace(_hit(point, cosines), lexical=str(point.id) in lexical) for point in points]


def _lexical_ids(
    store: QdrantStore,
    alias: str,
    scopes: Sequence[str],
    query_filter: models.Filter,
    vector: Sequence[float],
    lexical_text: str,
    exact_terms: Sequence[str],
    ids: Sequence[Any],
) -> set[str]:
    if not ids or (not lexical_text.strip() and not exact_terms):
        return set()
    among = models.Filter(must=[query_filter, models.HasIdCondition(has_id=list(ids))])
    channels = _prefetches(
        scopes, among, vector, lexical_text, exact_terms, len(ids), RANKING, store.bm25_length(scopes[0])
    )[1:]
    result = store.client.query_points(
        alias,
        prefetch=channels,
        query=models.RrfQuery(rrf=models.Rrf(k=RANKING.rrf_k)),
        limit=len(ids),
        with_payload=False,
    )
    return {str(point.id) for point in result.points}


def _group_in_order(points: Sequence[Any], group_by: str, groups: int, group_size: int) -> dict[str, list[Any]]:
    collected: dict[str, list[Any]] = {}
    for point in points:
        key = (point.payload or {}).get(group_by)
        if key is None:
            continue
        key = str(key)
        if key not in collected:
            if len(collected) >= groups:
                continue
            collected[key] = []
        if len(collected[key]) < group_size:
            collected[key].append(point)
    return collected
