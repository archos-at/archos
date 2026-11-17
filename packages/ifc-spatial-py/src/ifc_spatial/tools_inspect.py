from __future__ import annotations

from collections.abc import Callable
from functools import partial
from typing import Any

from ifc_spatial.tools_constants import _PROFILE_DROPS
from ifc_spatial.tools_constants import GEOMETRIC_RELATIONS
from ifc_spatial.tools_constants import MEASURE_EXPENSIVE
from ifc_spatial.tools_constants import MEASURE_FN
from ifc_spatial.tools_constants import MEASURE_SUBJECT
from ifc_spatial.tools_constants import MEASURES
from ifc_spatial.tools_constants import RELATION_FN
from ifc_spatial.tools_constants import RELATIONS
from ifc_spatial.tools_helpers import _clamp
from ifc_spatial.tools_helpers import _jsonable
from ifc_spatial.tools_helpers import _lower
from ifc_spatial.tools_helpers import _require
from ifc_spatial.tools_helpers import _select
from ifc_spatial.tools_measure import _compact
from ifc_spatial.tools_session import run
from ifc_spatial.tools_types import ToolDef
from ifc_spatial.tools_types import ToolError

from . import operators as op
from .briefing import KIND_LABEL
from .briefing import LEGACY_ROOM_USE_KINDS
from .briefing import inventory
from .model import SpatialModel
from .model import WrongKindError


def find_elements(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    limit = _clamp(args.get("limit", 50), 1, 500)
    matches, total = _select(model, args, limit)

    out: dict[str, Any] = {
        "elements": [model.ref(e).to_dict() for e in matches],
        "total": total,
        "truncated": total > len(matches),
    }
    if total == 0:
        out["hint"] = (
            'Keine Treffer. Vor der Schlussfolgerung „gibt es nicht" das Briefing prüfen: '
            "Geschoßnamen und Typen stammen aus diesem Export."
        )
    return out




def element(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    global_id = str(args.get("globalId") or "")
    try:
        subject = model.file.by_guid(global_id)
    except RuntimeError, KeyError:
        raise ToolError(
            f"Bauteil {global_id} ist in diesem Modell nicht enthalten — GlobalId mit find_elements prüfen"
        ) from None

    storey = model.storey_of(subject)
    container = run(lambda: op.container_of(model, global_id))
    available = []
    for name, fn in RELATION_FN.items():
        if name in GEOMETRIC_RELATIONS:
            continue
        try:
            answer = fn(model, global_id)
        except WrongKindError:
            continue
        if not answer.decidable:
            continue
        value = answer.value
        present = len(value) > 0 if isinstance(value, list) else value is not None
        if present:
            available.append(name)

    return {
        "element": model.ref(subject).to_dict(),
        "storey": getattr(storey, "Name", None),
        "elevation": next(
            (s.elevation for s in model.storeys if storey is not None and s.global_id == storey.GlobalId),
            None,
        ),
        "predefinedType": getattr(subject, "PredefinedType", None),
        "container": _jsonable(container.value),
        "available": available,
        "note": (
            "bounds, enclosedBy, opensTo und adjacentSpaces stehen nicht in dieser Liste: sie sind in "
            "einem Export ohne IfcRelSpaceBoundary nur aus der Geometrie ableitbar und kosten einmalig "
            "einige Sekunden. Über relations sind sie normal abrufbar."
        ),
    }




def relations(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    name = str(args.get("relation") or "")
    fn = RELATION_FN.get(name)
    if fn is None:
        raise ToolError(f'relation "{name}" gibt es nicht. Erlaubt: {", ".join(RELATIONS)}')
    return run(lambda: fn(model, str(args.get("globalId") or "")))


def _profile_measures(model: SpatialModel, global_id: str, applicable: list[str]) -> dict[str, Any]:
    measures: dict[str, Any] = {}
    for name in applicable:
        fn = MEASURE_FN[name]
        try:
            answer = _jsonable(run(lambda fn=fn: fn(model, global_id)))
        except Exception as exc:  # noqa: BLE001
            measures[name] = {"decidable": False, "error": f"{type(exc).__name__}: {exc}"}
            continue
        if isinstance(answer, dict):
            answer = {key: _compact(val) for key, val in answer.items() if key not in _PROFILE_DROPS}
        measures[name] = answer
    return measures


def element_profile(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    global_id = _require(args, "globalId")
    try:
        subject = model.file.by_guid(global_id)
    except RuntimeError, KeyError:
        raise ToolError(
            f"GlobalId {global_id} steht nicht in diesem Modell. "
            "Mit find_elements suchen — GlobalIds sind exakt 22 Zeichen und gelten je Datei."
        ) from None

    ifc_type = subject.is_a()
    applicable = [
        name
        for name in MEASURES
        if not MEASURE_SUBJECT.get(name, ())
        or any(subject.is_a(subject_type) for subject_type in MEASURE_SUBJECT[name])
    ]
    if not _lower(args.get("include")) == "expensive":
        applicable = [name for name in applicable if name not in MEASURE_EXPENSIVE]

    measures = _profile_measures(model, global_id, applicable)

    skipped = [name for name in MEASURES if name not in applicable]
    out: dict[str, Any] = {
        "element": model.ref(subject).to_dict(),
        "storey": getattr(model.storey_of(subject), "Name", None),
        "measures": measures,
    }
    if skipped:
        out["notMeasured"] = {
            "kinds": skipped,
            "why": (
                f"Diese Kennwerte sind nicht über ein {ifc_type} definiert (oder sind teuer und "
                'wurden übersprungen — dann include="expensive" setzen). Kein Befund über das '
                "Bauteil, sondern über die Frage."
            ),
        }
    return out




def shopping_list(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    try:
        from . import ids_export as ids
    except ImportError as error:
        raise ToolError(
            "Die IDS-Ausgabe steht in dieser Installation nicht zur Verfügung (ifctester fehlt). "
            "Die fehlenden Angaben stehen weiterhin im Briefing unter FEHLT und BLIND und können "
            "dort berichtet werden."
        ) from error

    model = resolve(args.get("model"))
    document = ids.blind_spots_as_ids(
        model,
        title=(str(args["title"]).strip() if args.get("title") else None),
        author=(str(args["author"]).strip() if args.get("author") else None),
    )
    written = ids.write_ids(document)
    return {**written, "summary": document.summary()}




def room_inventory(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    kind = str(args.get("kind") or "").strip()
    kind = LEGACY_ROOM_USE_KINDS.get(kind, kind)
    if kind not in KIND_LABEL:
        raise ToolError(
            f'kind "{kind}" gibt es nicht. Erlaubt: {", ".join(KIND_LABEL)}'
            if kind
            else f"kind fehlt. Erlaubt: {', '.join(KIND_LABEL)}"
        )
    return inventory(model, kind)  # type: ignore[arg-type]


def _find_elements_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="find_elements", handler=partial(find_elements, resolve))


def _element_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="element", handler=partial(element, resolve))


def _relations_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="relations", handler=partial(relations, resolve))


def _element_profile_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="element_profile", handler=partial(element_profile, resolve))


def _shopping_list_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="shopping_list", handler=partial(shopping_list, resolve))


def _room_inventory_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="room_inventory", handler=partial(room_inventory, resolve))
