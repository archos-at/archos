from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from typing import Literal

from qdrant_client import models

from agent.profile_names import legacy_profile_token

from .payload import coerce_field
from .schema import COUNTRY_FIELD
from .schema import DATETIME_FIELDS
from .schema import FOLDER_KIND
from .schema import INDEXED_FIELDS
from .schema import INTEGER_FIELDS
from .schema import KIND_FIELD
from .schema import LEGACY_CHUNKING
from .schema import LEGACY_FIELDS
from .schema import OFFICE_FIELD
from .schema import PROJECT_FACTS_FIELD
from .schema import RELEASED_FIELD
from .schema import SCOPE_FIELD
from .schema import TENANT_PREFIXES
from .schema import TEXT_FIELDS

PointKind = Literal["chunk", "folder", "any"]

_RANGE_OPERATORS = {"$gt": "gt", "$gte": "gte", "$lt": "lt", "$lte": "lte"}
_OPERATORS = frozenset({"$eq", "$ne", "$in", "$nin", "$exists", *_RANGE_OPERATORS})


def _range(field: str, op: str, value: Any) -> models.FieldCondition:
    bound = _RANGE_OPERATORS[op]
    if field in DATETIME_FIELDS:
        moment = coerce_field(field, value)
        if moment is None:
            raise ValueError(f"Filter on {field!r}: {op} needs an ISO 8601 date, got {value!r}")
        return models.FieldCondition(key=field, range=models.DatetimeRange(**{bound: moment}))
    if field not in INTEGER_FIELDS:
        raise ValueError(f"Filter on {field!r}: {op} needs an integer or datetime field")
    number = coerce_field(field, value)
    if number is None:
        raise ValueError(f"Filter on {field!r}: {op} needs a number, got {value!r}")
    return models.FieldCondition(key=field, range=models.Range(**{bound: number}))


def _match(field: str, value: Any) -> models.FieldCondition:
    if isinstance(value, (list, tuple, set)):
        return _match_any(field, value)
    coerced = coerce_field(field, value)
    if isinstance(coerced, list):
        return models.FieldCondition(key=field, match=models.MatchAny(any=coerced))
    return models.FieldCondition(key=field, match=models.MatchValue(value=coerced))


def _match_any(field: str, values: Any) -> models.FieldCondition:
    if not isinstance(values, (list, tuple, set)):
        raise ValueError(f"Filter on {field!r} expects a list, got {values!r}")
    coerced = [coerce_field(field, value) for value in values]
    flat: list[Any] = []
    for value in coerced:
        flat.extend(value if isinstance(value, list) else [value])
    unique = list(dict.fromkeys(value for value in flat if value is not None))
    return models.FieldCondition(key=field, match=models.MatchAny(any=unique))


def _legacy_value(field: str, value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        return [_legacy_value(field, item) for item in value]
    if field == "chunking":
        return LEGACY_CHUNKING.get(value, value)
    if field.startswith(f"{PROJECT_FACTS_FIELD}.") and isinstance(value, str):
        return legacy_profile_token(field.removeprefix(f"{PROJECT_FACTS_FIELD}."), value)
    return value


def _legacy_condition(field: str, condition: Any) -> tuple[str, Any] | None:
    old_field = LEGACY_FIELDS.get(field, field)
    if isinstance(condition, dict) and len(condition) == 1:
        op, value = next(iter(condition.items()))
        old: Any = {op: _legacy_value(field, value)}
    else:
        old = _legacy_value(field, condition)
    if old_field == field and old == condition:
        return None
    return old_field, old


def _field(field: str, condition: Any) -> models.Filter:
    primary = _field_exact(field, condition)
    legacy = _legacy_condition(field, condition)
    if legacy is None:
        return primary
    old = _field_exact(*legacy)
    negative = isinstance(condition, dict) and next(iter(condition), None) in {"$ne", "$nin"}
    return models.Filter(must=[primary, old]) if negative else models.Filter(should=[primary, old])


def _field_exact(field: str, condition: Any) -> models.Filter:
    if field not in INDEXED_FIELDS or field in TEXT_FIELDS:
        raise ValueError(f"Filter on {field!r}: not an indexed payload field")
    if not isinstance(condition, dict):
        return models.Filter(must=[_match(field, condition)])
    if len(condition) != 1 or next(iter(condition)) not in _OPERATORS:
        raise ValueError(f"Unsupported metadata filter condition for field {field!r}: {condition!r}")
    op, value = next(iter(condition.items()))
    if op == "$eq":
        return models.Filter(must=[_match(field, value)])
    if op == "$ne":
        return models.Filter(must_not=[_match(field, value)])
    if op == "$in":
        return models.Filter(must=[_match_any(field, value)])
    if op in _RANGE_OPERATORS:
        return models.Filter(must=[_range(field, op, value)])
    if op == "$exists":
        if not isinstance(value, bool):
            raise ValueError(f"Filter on {field!r}: $exists needs true or false, got {value!r}")
        empty = models.IsEmptyCondition(is_empty=models.PayloadField(key=field))
        return models.Filter(must_not=[empty]) if value else models.Filter(must=[empty])
    return models.Filter(must_not=[_match_any(field, value)] if value else [])


def translate(node: dict[str, Any]) -> models.Filter:
    if not node:
        raise ValueError("Unsupported metadata filter: empty group")
    parts: list[models.Filter] = []
    for key, condition in node.items():
        if key in {"$and", "$or"}:
            if not isinstance(condition, list) or not condition:
                raise ValueError(f"Unsupported metadata filter operator: {key!r} (expects a non-empty list)")
            children = [translate(child) for child in condition]
            parts.append(models.Filter(must=children) if key == "$and" else models.Filter(should=children))
        elif key.startswith("$"):
            raise ValueError(f"Unsupported metadata filter operator: {key!r}")
        else:
            parts.append(_field(key, condition))
    return parts[0] if len(parts) == 1 else models.Filter(must=parts)


def scope_condition(scopes: Sequence[str]) -> models.FieldCondition:
    names = [scope for scope in scopes if isinstance(scope, str) and scope.strip()]
    if not names or len(names) != len(scopes):
        raise ValueError(f"A Qdrant read needs at least one non-empty scope, got {list(scopes)!r}")
    return models.FieldCondition(key=SCOPE_FIELD, match=models.MatchAny(any=list(dict.fromkeys(names))))


def _is_folder() -> models.FieldCondition:
    return models.FieldCondition(key=KIND_FIELD, match=models.MatchValue(value=FOLDER_KIND))


def kind_filter(kind: PointKind = "chunk") -> models.Filter:
    if kind == "chunk":
        return models.Filter(must_not=[_is_folder()])
    if kind == "folder":
        return models.Filter(must=[_is_folder()])
    return models.Filter()


def scope_filter(
    scopes: Sequence[str],
    filters: dict[str, Any] | None = None,
    *extra: models.Condition,
    kind: PointKind = "chunk",
) -> models.Filter:
    if kind not in ("chunk", "folder", "any"):
        raise ValueError(f"Unknown point kind {kind!r}")
    must: list[Any] = [scope_condition(scopes)]
    country = corpus_country_condition(scopes)
    if country is not None:
        must.append(country)
    if filters:
        must.append(translate(filters))
    must.extend(extra)
    if kind == "folder":
        must.append(_is_folder())
    return models.Filter(must=must, must_not=[_is_folder()] if kind == "chunk" else None)


def corpus_country_condition(scopes: Sequence[str]) -> models.Filter | None:
    if all(is_tenant_scope(scope) for scope in scopes):
        return None
    from agent.common.knowledge_context import UNSCOPED
    from agent.common.knowledge_context import corpus_countries

    countries = corpus_countries()
    if countries is UNSCOPED:
        return None
    allowed = sorted(countries) or ["__none__"]
    released = models.Filter(
        must=[models.FieldCondition(key=COUNTRY_FIELD, match=models.MatchAny(any=allowed))],
        must_not=[models.FieldCondition(key=RELEASED_FIELD, match=models.MatchValue(value=False))],
    )
    should: list[Any] = [released]
    tenant = [scope for scope in scopes if is_tenant_scope(scope)]
    if tenant:
        should.append(scope_condition(tenant))
    return models.Filter(should=should)


def is_tenant_scope(scope: str) -> bool:
    return scope.startswith(TENANT_PREFIXES)


@dataclass(frozen=True)
class ScopeRead:

    scopes: tuple[str, ...]
    office_id: str | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "scopes", tuple(self.scopes))
        office = self.office_id.strip() if isinstance(self.office_id, str) else ""
        object.__setattr__(self, "office_id", office or None)
        if self.tenant_scopes and self.office_id is None:
            raise ValueError(f"A read over the office scopes {list(self.tenant_scopes)!r} needs the office it reads as")

    @property
    def tenant_scopes(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(scope for scope in self.scopes if isinstance(scope, str) and is_tenant_scope(scope)))

    def filter(
        self, filters: dict[str, Any] | None = None, *extra: models.Condition, kind: PointKind = "chunk"
    ) -> models.Filter:
        return scope_filter(self.scopes, filters, *extra, *self.office(), kind=kind)

    def office(self) -> list[models.Filter]:
        condition = office_condition(self)
        return [condition] if condition is not None else []


def office_condition(read: ScopeRead) -> models.Filter | None:
    tenant = read.tenant_scopes
    if not tenant:
        return None
    return models.Filter(
        should=[
            models.Filter(must_not=[models.FieldCondition(key=SCOPE_FIELD, match=models.MatchAny(any=list(tenant)))]),
            models.FieldCondition(key=OFFICE_FIELD, match=models.MatchValue(value=str(read.office_id))),
            models.IsEmptyCondition(is_empty=models.PayloadField(key=OFFICE_FIELD)),
        ]
    )
