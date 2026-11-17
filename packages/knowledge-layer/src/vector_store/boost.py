from __future__ import annotations

from collections.abc import Collection
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import fields
from itertools import combinations
from typing import Any

from qdrant_client import models

from agent.profile_names import legacy_profile_token

from .payload import project_payload
from .schema import KNOWLEDGE_EDITION_FIELD
from .schema import LEGACY_FIELDS
from .schema import PROJECT_FACTS_FIELD
from .schema import fact_field

LIKENESS = 0.05

EDITION_PREFERENCE = 0.05

MAX_USES = 6


@dataclass(frozen=True)
class FactWeights:

    federal_state: float = 0.0
    building_class: float = 0.0
    building_class_adjacent: float = 0.0
    construction_method: float = 0.0
    use: float = 0.0
    use_max: float = 0.0
    work_type: float = 0.0

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> FactWeights:
        values: dict[str, float] = {}
        for field in fields(cls):
            value = float(raw.get(field.name) or 0.0)
            if value < 0:
                raise ValueError(f"boost weight {field.name} must not be negative, got {value}")
            values[field.name] = value
        return cls(**values)

    @property
    def most(self) -> float:
        return (
            self.federal_state
            + max(self.building_class, self.building_class_adjacent)
            + self.construction_method
            + self.use_max
            + self.work_type
        )


@dataclass(frozen=True)
class Boost:

    facts: Mapping[str, Any]
    weights: FactWeights


def parse_boost(raw: Mapping[str, Any] | None) -> Boost | None:
    if not raw:
        return None
    facts = project_payload(raw.get("facts"), "active")[PROJECT_FACTS_FIELD]
    return Boost(facts=facts, weights=FactWeights.from_mapping(raw.get("weights") or {}))


def _any(key: str, values: list[Any]) -> models.Filter:
    field = fact_field(key)
    legacy_values = [legacy_profile_token(key, value) if isinstance(value, str) else value for value in values]
    return models.Filter(
        should=[
            models.FieldCondition(key=field, match=models.MatchAny(any=values)),
            models.FieldCondition(key=LEGACY_FIELDS[field], match=models.MatchAny(any=legacy_values)),
        ]
    )


def _class_terms(classes: list[int], weights: FactWeights) -> list[tuple[float, Any]]:
    if not classes:
        return []
    exact = _any("building_class", classes)
    terms: list[tuple[float, Any]] = [(weights.building_class, exact)]
    neighbours = sorted({gk + step for gk in classes for step in (-1, 1)} - set(classes))
    if neighbours:
        adjacent = models.Filter(must=[_any("building_class", neighbours)], must_not=[exact])
        terms.append((weights.building_class_adjacent, adjacent))
    return terms


def _use_terms(uses: list[str], weights: FactWeights) -> list[tuple[float, Any]]:
    if weights.use <= 0 or not uses:
        return []
    uses = uses[:MAX_USES]
    terms: list[tuple[float, Any]] = []
    for shared in range(1, len(uses) + 1):
        step = min(weights.use, weights.use_max - (shared - 1) * weights.use)
        if step <= 0:
            break
        if shared == 1:
            terms.append((step, _any("uses", uses)))
            continue
        groups = [models.Filter(must=[_any("uses", [use]) for use in group]) for group in combinations(uses, shared)]
        terms.append((step, models.Filter(should=groups)))
    return terms


def boost_terms(boost: Boost) -> list[tuple[float, Any]]:
    facts, weights = boost.facts, boost.weights
    terms: list[tuple[float, Any]] = []
    if facts.get("federal_state"):
        terms.append((weights.federal_state, _any("federal_state", [facts["federal_state"]])))
    terms.extend(_class_terms(list(facts.get("building_class") or []), weights))
    if facts.get("construction_method"):
        terms.append((weights.construction_method, _any("construction_method", list(facts["construction_method"]))))
    terms.extend(_use_terms(list(facts.get("uses") or []), weights))
    if facts.get("work_type"):
        terms.append((weights.work_type, _any("work_type", list(facts["work_type"]))))
    return [(weight, condition) for weight, condition in terms if weight > 0]


def ranking_formula(boost: Boost | None, editions: Collection[str] = ()) -> models.FormulaQuery | None:
    terms = [(LIKENESS / boost.weights.most * weight, term) for weight, term in boost_terms(boost)] if boost else []
    if editions:
        binding = models.FieldCondition(key=KNOWLEDGE_EDITION_FIELD, match=models.MatchAny(any=sorted(editions)))
        terms.append((EDITION_PREFERENCE, binding))
    if not terms:
        return None
    factor = models.SumExpression(
        sum=[1.0] + [models.MultExpression(mult=[weight, condition]) for weight, condition in terms]
    )
    return models.FormulaQuery(formula=models.MultExpression(mult=["$score", factor]))


def boosted(channel: models.Prefetch, formula: models.FormulaQuery | None) -> models.Prefetch:
    if formula is None:
        return channel
    return models.Prefetch(prefetch=[channel], query=formula, limit=channel.limit)
