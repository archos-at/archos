from __future__ import annotations

import math
from collections.abc import Container
from collections.abc import Hashable
from collections.abc import Mapping
from collections.abc import Sequence

K_VALUES: tuple[int, ...] = (1, 3, 5, 10, 16, 20)


def _prefix(ranked: Sequence[Hashable], k: int) -> Sequence[Hashable]:
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    return ranked[:k]


def recall_at_k(ranked: Sequence[Hashable], relevant: Container[Hashable], k: int) -> float:
    total = len(relevant)  # type: ignore[arg-type]
    if total == 0:
        return 0.0
    found = sum(1 for unit in _prefix(ranked, k) if unit in relevant)
    return found / total


def precision_at_k(ranked: Sequence[Hashable], relevant: Container[Hashable], k: int) -> float:
    hits = sum(1 for unit in _prefix(ranked, k) if unit in relevant)
    return hits / k


def ndcg_at_k(ranked: Sequence[Hashable], grades: Mapping[Hashable, int], k: int) -> float:
    prefix = _prefix(ranked, k)
    dcg = 0.0
    for rank, unit in enumerate(prefix, start=1):
        grade = grades.get(unit, 0)
        if grade > 0:
            dcg += (2**grade - 1) / math.log2(rank + 1)

    ideal_grades = sorted((grade for grade in grades.values() if grade > 0), reverse=True)[:k]
    idcg = sum((2**grade - 1) / math.log2(rank + 1) for rank, grade in enumerate(ideal_grades, start=1))
    if idcg == 0.0:
        return 0.0
    return dcg / idcg


def mrr(ranked: Sequence[Hashable], relevant: Container[Hashable], k: int | None = None) -> float:
    prefix = ranked if k is None else _prefix(ranked, k)
    for rank, unit in enumerate(prefix, start=1):
        if unit in relevant:
            return 1.0 / rank
    return 0.0


def forbidden_rate(
    rankings: Sequence[Sequence[Hashable]],
    forbidden_sets: Sequence[Container[Hashable]],
    k: int,
) -> float:
    if len(rankings) != len(forbidden_sets):
        raise ValueError(f"rankings ({len(rankings)}) and forbidden_sets ({len(forbidden_sets)}) must be parallel")
    if not rankings:
        return 0.0
    hits = sum(
        1
        for ranked, forbidden in zip(rankings, forbidden_sets, strict=True)
        if any(unit in forbidden for unit in _prefix(ranked, k))
    )
    return hits / len(rankings)


def fill_rate(ranked: Sequence[Hashable], k: int) -> float:
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    return min(len(ranked), k) / k


def mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)
