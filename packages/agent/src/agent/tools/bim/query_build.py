import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from agent.profile_names import normalize_profile_token

VALID_OPERATIONS = {
    "overview",
    "health",
    "schedule",
    "takeoff",
    "profile",
    "types",
    "elements",
    "element",
    "properties",
    "aggregate",
    "compare",
    "compliance",
    "compliance-diff",
}


_MAIN_USES = frozenset(
    {
        "residential",
        "office",
        "lodging",
        "assembly",
        "healthcare",
        "agriculture",
        "manufacturing",
        "storage",
        "other",
    }
)


def _valid_main_use(value: str) -> str:
    lowered = normalize_profile_token("main_use", value.strip().lower())
    return lowered if lowered in _MAIN_USES else ""


def _valid_building_class(value: int | None) -> int:
    return value if value and 1 <= value <= 5 else 0


_BARE_OPS = frozenset({"overview", "types", "health", "schedule", "profile"})

_WHOLE_MODEL_OPS = {
    "overview": "a summary of the whole model",
    "types": "the type distribution of the whole model",
    "health": "the health check of the whole model",
    "schedule": "the room schedule (Raumbuch) of the whole model",
    "profile": "the project facts derivable from the whole model",
    "compare": "a comparison of two complete versions",
    "element": "a single element",
    "compliance": "a check of the whole model against the rule catalogue",
    "compliance-diff": "a check of both versions against the rule catalogue",
    "properties": "the model's property catalogue (restrictable to one type with 'ifc_type')",
}

_METRICS = frozenset({"count", "sum", "avg", "min", "max"})


@dataclass(frozen=True)
class _QueryArgs:
    filters: dict[str, Any]
    metric: str
    quantity: str
    group_by: str
    global_id: str
    ifc_type: str
    limit: int
    building_class: int | None
    main_use: str


def _parse_filters(filters: str) -> dict[str, Any] | str:
    if not filters.strip():
        return {}
    try:
        candidate = json.loads(filters)
    except json.JSONDecodeError:
        return 'Error: \'filters\' must be a JSON object, e.g. {"ifcTypes": ["IfcWall"]}.'
    if not isinstance(candidate, dict):
        return "Error: 'filters' must be a JSON object, not a list or scalar."
    return candidate


def _compliance_query(op: str, args: _QueryArgs) -> dict[str, Any]:
    query: dict[str, Any] = {"op": op}
    klasse = _valid_building_class(args.building_class)
    if klasse:
        query["buildingClass"] = klasse
    nutzung = _valid_main_use(args.main_use)
    if nutzung:
        query["mainUse"] = nutzung
    return query


def _takeoff_query(args: _QueryArgs) -> dict[str, Any] | str:
    grouping = args.group_by.lower()
    if grouping and grouping != "material":
        return (
            f"Error: operation 'takeoff' can only group by 'material', not '{args.group_by}'. "
            "Use 'aggregate' with metric='sum' to group a quantity by storey or type."
        )
    return {
        "op": "takeoff",
        "quantity": args.quantity or "NetSideArea",
        "byMaterial": grouping == "material",
        "filter": args.filters,
    }


def _properties_query(args: _QueryArgs) -> dict[str, Any]:
    query: dict[str, Any] = {"op": "properties"}
    if args.ifc_type:
        query["ifcType"] = args.ifc_type
    return query


def _element_query(args: _QueryArgs) -> dict[str, Any] | str:
    if not args.global_id:
        return "Error: operation 'element' needs a global_id (the element's IFC GlobalId)."
    return {"op": "element", "globalId": args.global_id}


def _elements_query(args: _QueryArgs) -> dict[str, Any]:
    return {"op": "elements", "filter": args.filters, "limit": args.limit, "offset": 0}


def _aggregate_query(args: _QueryArgs) -> dict[str, Any] | str:
    metric = (args.metric or "count").lower()
    if metric not in _METRICS:
        return "Error: metric must be one of count, sum, avg, min, max."
    query: dict[str, Any] = {"op": "aggregate", "filter": args.filters, "metric": metric, "limit": args.limit}
    if metric != "count" and not args.quantity:
        return f"Error: metric '{metric}' needs a 'quantity' (e.g. NetFloorArea)."
    if metric != "count":
        query["quantity"] = args.quantity
    if args.group_by.lower() == "property":
        return (
            "Error: group_by='property' is not available through this tool. "
            "Use operation='properties' to see which values a property takes and how many "
            "elements carry each, or filter on the property and count."
        )
    if args.group_by:
        query["groupBy"] = args.group_by
    return query


_QUERY_BUILDERS: dict[str, Callable[[_QueryArgs], dict[str, Any] | str]] = {
    "compliance": lambda args: _compliance_query("compliance", args),
    "compliance-diff": lambda args: _compliance_query("compliance-diff", args),
    "takeoff": _takeoff_query,
    "compare": lambda args: {"op": "compare", "limit": 20000},
    "properties": _properties_query,
    "element": _element_query,
    "elements": _elements_query,
    "aggregate": _aggregate_query,
}


def _build_query(
    operation: str,
    filters: str,
    metric: str,
    quantity: str,
    group_by: str,
    global_id: str,
    ifc_type: str,
    limit: int,
    building_class: int | None = 0,
    main_use: str = "",
) -> dict[str, Any] | str:
    if operation not in VALID_OPERATIONS:
        return f"Error: unknown operation '{operation}'. Use one of: {', '.join(sorted(VALID_OPERATIONS))}."
    parsed = _parse_filters(filters)
    if isinstance(parsed, str):
        return parsed
    if parsed and operation in _WHOLE_MODEL_OPS:
        return (
            f"Error: operation '{operation}' takes no filters — it returns {_WHOLE_MODEL_OPS[operation]}. "
            "Use 'elements' or 'aggregate' to ask a filtered question, or drop 'filters'."
        )
    if operation in _BARE_OPS:
        return {"op": operation}
    args = _QueryArgs(
        filters=parsed,
        metric=metric.strip(),
        quantity=quantity.strip(),
        group_by=group_by.strip(),
        global_id=global_id.strip(),
        ifc_type=ifc_type.strip(),
        limit=max(1, min(limit, 200)),
        building_class=building_class,
        main_use=main_use,
    )
    return _QUERY_BUILDERS[operation](args)
