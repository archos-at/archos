from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import operators as op
from .circulation_records import NON_TRAVERSABLE_DOOR_TYPES
from .circulation_records import OUTSIDE
from .circulation_records import OUTSIDE_REF
from .circulation_records import DoorEdge
from .circulation_records import DoorGraph
from .envelope import MissingFact
from .model import CONTACT_BUDGET_SECONDS
from .model import SpatialModel

_STRUCTURE_CAVEAT = (
    "Der Graph kennt ausschließlich Türen. Treppen, Rampen und Aufzüge sind keine Kanten, ein Weg über ein "
    "anderes Geschoss ist damit nicht abbildbar. Wanddurchbrüche ohne Tür und IfcVirtualElement-Grenzen sind "
    "ebenfalls unsichtbar — dort kann der Graph einen längeren Weg oder gar keinen melden, obwohl ein "
    "kürzerer begehbar ist."
)

_MEMO_ATTR = "_ifc_spatial_circulation_build"


@dataclass(frozen=True)
class _Build:
    graph: DoorGraph | None
    missing: MissingFact | None
    provenance: str
    from_: list[str]
    caveat: str | None


def _cached_build(model: SpatialModel) -> _Build:
    cached = getattr(model, _MEMO_ATTR, None)
    if isinstance(cached, _Build):
        return cached
    built = _build(model)
    setattr(model, _MEMO_ATTR, built)
    return built


def _build(model: SpatialModel) -> _Build:
    t0 = time.perf_counter()
    spaces = list(model.file.by_type("IfcSpace"))
    doors = list(model.file.by_type("IfcDoor"))
    if refusal := _missing_input(model, spaces, doors):
        return refusal

    nodes = [model.ref(space) for space in spaces]
    nodes.append(OUTSIDE_REF)
    known = {space.GlobalId for space in spaces}

    edges: list[DoorEdge] = []
    unresolved: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    derived_any = False

    for door in sorted(doors, key=lambda d: d.GlobalId):
        derived_any = _place_door(model, door, known, edges, unresolved, excluded) or derived_any

    if not model.contacts_complete:
        return _incomplete_contacts(model, spaces, doors)

    graph = DoorGraph(
        nodes=tuple(nodes),
        edges=tuple(edges),
        unresolved=tuple(unresolved),
        excluded=tuple(excluded),
        build_seconds=time.perf_counter() - t0,
    )
    return _Build(
        graph=graph,
        missing=None,
        provenance="computed" if derived_any else "declared",
        from_=[],
        caveat=_graph_caveat(graph, derived_any),
    )


def _missing_input(model: SpatialModel, spaces: list[Any], doors: list[Any]) -> _Build | None:
    if not spaces:
        return _Build(
            graph=None,
            missing=MissingFact(
                what="IfcSpace",
                remedy=(
                    "Dieser Export enthält keine Räume. Räume im CAD als IfcSpace exportieren — ohne Räume "
                    "gibt es keine Knoten, zwischen denen ein Weg verlaufen könnte."
                ),
            ),
            provenance="declared",
            from_=[],
            caveat=None,
        )
    if not doors:
        return _Build(
            graph=None,
            missing=MissingFact(
                what="IfcDoor",
                remedy=(
                    "Dieser Export enthält keine Türen. Türen als IfcDoor mit Raumbezug exportieren "
                    "(idealerweise zusätzlich Space Boundaries 2nd level) — ohne Türen hat der Graph keine "
                    "Kanten, und jeder Raum sähe ausweglos aus, obwohl das eine Aussage über den Export wäre "
                    "und nicht über das Gebäude."
                ),
            ),
            provenance="declared",
            from_=[],
            caveat=None,
        )

    declared_route = any(getattr(door, "ProvidesBoundaries", None) for door in doors)
    if not declared_route and not model.derivable_boundaries:
        refusal = op._too_big_to_derive(model, "doorGraph()", doors[0].GlobalId)
        return _Build(
            graph=None,
            missing=refusal.missing,
            provenance="computed",
            from_=[doors[0].GlobalId],
            caveat=None,
        )
    return None


def _incomplete_contacts(model: SpatialModel, spaces: list[Any], doors: list[Any]) -> _Build:
    total = len(spaces)
    return _Build(
        graph=None,
        missing=MissingFact(
            what="IfcRelSpaceBoundary (die Ableitung aus der Geometrie ist für dieses Modell zu teuer)",
            remedy=(
                f"Dieser Export enthält keine Raumgrenzen, und die Ableitung aus den Körpern wurde nach "
                f"{model.contacts_covered} von {total} Räumen abgebrochen (Zeitbudget "
                f"{int(CONTACT_BUDGET_SECONDS)} s). Ein unvollständiger Türgraph wäre von einem Gebäude "
                "mit weniger Türen nicht zu unterscheiden — eine fehlende Kante ist ein fehlender Weg — "
                "deshalb wird keiner ausgegeben. Abhilfe: Space Boundaries (2nd level) mitexportieren — "
                "in Revit/ArchiCAD eine Exporteinstellung — oder dieses Modell in einem Worker ohne "
                "Anfragezeitlimit auswerten."
            ),
        ),
        provenance="computed",
        from_=[door.GlobalId for door in doors],
        caveat=None,
    )


def _place_door(
    model: SpatialModel,
    door: Any,
    known: set[str],
    edges: list[DoorEdge],
    unresolved: list[dict[str, Any]],
    excluded: list[dict[str, Any]],
) -> bool:
    predefined = getattr(door, "PredefinedType", None)
    predefined = str(predefined) if predefined is not None else None
    if predefined in NON_TRAVERSABLE_DOOR_TYPES:
        excluded.append(_trapdoor(model, door, predefined))
        return False

    touching = op.opens_to(model, door.GlobalId)
    if not touching.decidable or touching.value is None:
        unresolved.append(_undetermined(model, door, touching))
        return False
    derived = touching.provenance != "declared"

    via = "IfcRelSpaceBoundary" if touching.provenance == "declared" else "geom.tree.select"
    rooms = sorted({ref.global_id for ref in touching.value if ref.kind == "space" and ref.global_id in known})

    if not rooms:
        excluded.append(_touches_no_room(model, door))
        return derived

    if len(rooms) == 1:
        _place_exit(model, door, predefined, rooms[0], via, edges, excluded)
        return derived

    edges.extend(_room_pair_edges(model, door, predefined, rooms, via))
    return derived


def _trapdoor(model: SpatialModel, door: Any, predefined: str | None) -> dict[str, Any]:
    return {
        "globalId": door.GlobalId,
        "name": model.label(door),
        "ifcType": door.is_a(),
        "predefinedType": predefined,
        "why": (
            "PredefinedType = TRAPDOOR: eine Boden- oder Deckenluke connects zwar, ist aber "
            "nicht begehbar — ein Fluchtweg führt nicht über eine Leiter."
        ),
    }


def _undetermined(model: SpatialModel, door: Any, touching: Any) -> dict[str, Any]:
    return {
        "globalId": door.GlobalId,
        "name": model.label(door),
        "ifcType": door.is_a(),
        "why": touching.missing.what if touching.missing else "opensTo() war nicht entscheidbar",
        "remedy": touching.missing.remedy if touching.missing else None,
    }


def _touches_no_room(model: SpatialModel, door: Any) -> dict[str, Any]:
    return {
        "globalId": door.GlobalId,
        "name": model.label(door),
        "ifcType": door.is_a(),
        "why": (
            "Diese Tür berührt keinen der modellierten Räume. Sie connects in dieser Datei "
            "nichts — möglicherweise fehlt der Raum dahinter im Export."
        ),
    }


def _place_exit(
    model: SpatialModel,
    door: Any,
    predefined: str | None,
    room: str,
    via: str,
    edges: list[DoorEdge],
    excluded: list[dict[str, Any]],
) -> None:
    outside, why = op._faces_outside(model, door)
    if outside is not True:
        excluded.append(
            {
                "globalId": door.GlobalId,
                "name": model.label(door),
                "ifcType": door.is_a(),
                "why": (
                    f"Diese Tür berührt nur einen Raum, liegt aber nicht außen ({why}). Der Bereich "
                    "auf der anderen Seite ist im Export nicht als IfcSpace modelliert. Als Ausgang "
                    "ins Freie wird sie deshalb NICHT gewertet — das wäre ein erfundener Ausweg."
                ),
                "remedy": (
                    "Den Bereich hinter dieser Tür als IfcSpace modellieren, oder an der zugehörigen "
                    "Wand Pset_WallCommon.IsExternal setzen, wenn sie tatsächlich ins Freie führt."
                ),
            }
        )
        return
    edges.append(
        DoorEdge(
            global_id=door.GlobalId,
            name=model.label(door),
            ifc_type=door.is_a(),
            predefined_type=predefined,
            a=room,
            b=OUTSIDE,
            length=_leg(model, room, door.GlobalId),
            external=True,
            via=f"{via} + {why}",
        )
    )


def _room_pair_edges(
    model: SpatialModel, door: Any, predefined: str | None, rooms: list[str], via: str
) -> list[DoorEdge]:
    ambiguous = len(rooms) > 2
    return [
        DoorEdge(
            global_id=door.GlobalId,
            name=model.label(door),
            ifc_type=door.is_a(),
            predefined_type=predefined,
            a=first,
            b=second,
            length=_traverse(model, first, door.GlobalId, second),
            external=False,
            via=via,
            ambiguous=ambiguous,
        )
        for i, first in enumerate(rooms)
        for second in rooms[i + 1 :]
    ]


def _graph_caveat(graph: DoorGraph, derived_any: bool) -> str:
    caveat = _STRUCTURE_CAVEAT
    if derived_any:
        caveat += " " + op._DERIVED_BOUNDARY_CAVEAT.format(contact=op.CONTACT)
    if graph.unresolved:
        caveat += (
            f" Bei {len(graph.unresolved)} Tür(en) ließen sich die angrenzenden Räume NICHT bestimmen; sie "
            "sind keine Kante und stehen unter „unbestimmt“. Jede davon ist ein möglicher Weg, den dieser "
            "Graph nicht kennt — die Wege sind insofern höchstens so gut wie dieser Export."
        )
    if graph.excluded:
        caveat += (
            f" {len(graph.excluded)} Tür(en) wurden bewusst nicht als Kante geführt; die Begründung steht "
            "je Tür unter „ausgeschlossen“."
        )
    if any(edge.ambiguous for edge in graph.edges):
        caveat += (
            " Mindestens eine Tür berührt mehr als zwei Räume — das tut keine wirkliche Tür, die Ableitung "
            "hat an der Berührungstoleranz einen Nachbarraum mitgenommen. Die Kanten sind trotzdem gesetzt "
            "(eine echte Außentür zu verwerfen würde einen Raum ausweglos erscheinen lassen), sind aber als "
            "„ambiguous“ markiert."
        )
    joined = {edge.a for edge in graph.edges} | {edge.b for edge in graph.edges}
    isolated = [ref for ref in graph.nodes if ref.global_id != OUTSIDE and ref.global_id not in joined]
    if isolated:
        caveat += (
            f" {len(isolated)} Raum/Räume haben überhaupt keine Türkante: "
            + ", ".join(f"„{ref.name or ref.global_id}“" for ref in isolated)
            + ". Das ist ein Befund und keine Nebensache — entweder fehlen dort Türen im Export, oder der "
            "Raum ist nur über Treppe, Leiter oder eine Öffnung ohne Tür erreichbar, die dieser Graph "
            "nicht kennt."
        )
    return caveat


def _centre(model: SpatialModel, global_id: str) -> np.ndarray | None:
    geo = model.geometry(global_id)
    return None if geo is None else geo.centroid


def _leg(model: SpatialModel, node: str, door_id: str) -> float | None:
    if node == OUTSIDE:
        return 0.0
    a = _centre(model, node)
    b = _centre(model, door_id)
    if a is None or b is None:
        return None
    return math.hypot(float(a[0] - b[0]), float(a[1] - b[1]))


def _traverse(model: SpatialModel, a: str, door_id: str, b: str) -> float | None:
    first = _leg(model, a, door_id)
    second = _leg(model, b, door_id)
    if first is None or second is None:
        return None
    return first + second
