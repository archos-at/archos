from __future__ import annotations

import dataclasses
import math
from typing import Any

import numpy as np

from ifc_spatial.tools_types import ToolError

from .model import SpatialModel



def _select(
    model: SpatialModel,
    args: dict[str, Any],
    limit: int,
    subject_types: tuple[str, ...] = (),
) -> tuple[list[Any], int]:
    wanted_type = _lower(args.get("ifcType"))
    wanted_name = _lower(args.get("nameContains"))
    wanted_storey = _lower(args.get("storey"))
    wanted_kind = _lower(args.get("kind"))

    matches: list[Any] = []
    total = 0
    for element in _nodes(model):
        if wanted_type and element.is_a().lower() != wanted_type:
            continue
        if subject_types and not any(element.is_a(subject) for subject in subject_types):
            continue
        if wanted_kind and model.kind_of(element) != wanted_kind:
            continue
        if wanted_storey:
            storey = model.storey_of(element)
            if (getattr(storey, "Name", None) or "").lower() != wanted_storey:
                continue
        if wanted_name:
            haystack = f"{getattr(element, 'Name', '') or ''} {getattr(element, 'LongName', '') or ''}".lower()
            if wanted_name not in haystack:
                continue
        total += 1
        if len(matches) < limit:
            matches.append(element)
    return matches, total




def _nodes(model: SpatialModel) -> list[Any]:
    return [
        *model.file.by_type("IfcProject"),
        *model.file.by_type("IfcProduct"),
        *model.file.by_type("IfcGroup"),
    ]


def _jsonable(value: Any) -> Any:
    if isinstance(value, (str, bool, int)) or value is None:
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _jsonable(value.to_dict())
    if isinstance(value, np.generic):
        return _jsonable(value.item())
    if isinstance(value, np.ndarray):
        return [_jsonable(v) for v in value.tolist()]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {k: _jsonable(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(v) for v in value]
    return str(value)


def _short(digest: str) -> str:
    return digest[:12]


def _lower(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def _clamp(value: Any, low: int, high: int) -> int:
    try:
        number = int(float(value))
    except TypeError, ValueError:
        return low
    return max(low, min(high, number))


def _require(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ToolError(f"{key} fehlt — eine GlobalId angeben (aus find_elements)")
    return value.strip()
