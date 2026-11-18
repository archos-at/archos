from __future__ import annotations

import heapq
import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import operators as op
from .envelope import Answer
from .envelope import ElementRef
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import undecidable
from .model import CONTACT_BUDGET_SECONDS
from .model import SpatialModel

OUTSIDE = "AUSSEN"

OUTSIDE_REF = ElementRef(
    global_id=OUTSIDE,
    ifc_type="—",
    name="Freie (außerhalb des Gebäudes)",
    kind="outside",
    via="synthetischer Knoten — außen liegt kein IfcSpace",
)

NON_TRAVERSABLE_DOOR_TYPES = frozenset({"TRAPDOOR"})

_POLYLINE_CAVEAT = (
    "Die Länge ist ein POLYGONZUG durch die Raumschwerpunkte und die Türmittelpunkte, in der Grundrissebene "
    "gemessen: Raummitte → Tür → Raummitte → … Das ist NICHT die Fluchtweglänge, wie sie geprüft wird. Ein "
    "Fluchtweg wird entlang des tatsächlich begehbaren Weges gemessen — um Möbel, Einbauten und Ecken herum, "
    "mit den Umwegen, die ein Türblatt und sein Schwenkbereich erzwingen. Dieser Polygonzug schneidet Ecken "
    "ab, verläuft diagonal durch Wände und kennt keine Einrichtung; er ist deshalb in aller Regel KÜRZER als "
    "der wirkliche Weg. Das ist die gefährliche Richtung: ein zu kurz gemessener Weg lässt einen zu langen "
    "Weg unauffällig aussehen. Diese Zahl ist eine UNTERGRENZE und darf nicht als Fluchtweglänge im Sinne "
    "der OIB-Richtlinie 2 verwendet werden. Sie kann umgekehrt auch zu lang werden, wenn sie durch die Mitte "
    "eines großen Raums führt, obwohl man an dessen Rand entlangginge. Kurz: die Zahl ordnet Räume nach "
    "Entfernung, sie bemisst keinen Weg."
)

_STRUCTURE_CAVEAT = (
    "Der Graph kennt ausschließlich Türen. Treppen, Rampen und Aufzüge sind keine Kanten, ein Weg über ein "
    "anderes Geschoss ist damit nicht abbildbar. Wanddurchbrüche ohne Tür und IfcVirtualElement-Grenzen sind "
    "ebenfalls unsichtbar — dort kann der Graph einen längeren Weg oder gar keinen melden, obwohl ein "
    "kürzerer begehbar ist."
)

_ENDPOINT_CAVEAT = (
    "Die letzte Teilstrecke endet an der Außentür, nicht an einem sicheren Ort im Freien: außerhalb des "
    "Gebäudes gibt es keinen IfcSpace und damit keinen Punkt, auf den gemessen werden könnte."
)

_CENTROID_CAVEAT = (
    "Gemessen wird auf den flächengewichteten Schwerpunkt des Raumkörpers. Bei L-förmigen oder anderweitig "
    "nicht konvexen Räumen kann dieser Punkt außerhalb des Raums liegen."
)

_MEMO_ATTR = "_ifc_spatial_circulation_build"


@dataclass(frozen=True)
class DoorEdge:
    global_id: str
    name: str | None
    ifc_type: str
    predefined_type: str | None
    a: str
    b: str
    length: float | None
    external: bool
    via: str
    ambiguous: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "globalId": self.global_id,
            "name": self.name,
            "ifcType": self.ifc_type,
            "predefinedType": self.predefined_type,
            "connects": [self.a, self.b],
            "length": self.length,
            "external": self.external,
            "via": self.via,
            "ambiguous": self.ambiguous,
        }


@dataclass(frozen=True)
class DoorGraph:
    nodes: tuple[ElementRef, ...]
    edges: tuple[DoorEdge, ...]
    unresolved: tuple[dict[str, Any], ...]
    excluded: tuple[dict[str, Any], ...]
    build_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": [ref.to_dict() for ref in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "undetermined": list(self.unresolved),
            "excluded": list(self.excluded),
            "buildSeconds": round(self.build_seconds, 3),
        }


@dataclass(frozen=True)
class _Build:
    graph: DoorGraph | None
    missing: MissingFact | None
    provenance: str
    from_: list[str]
    caveat: str | None


def door_graph(model: SpatialModel) -> Answer[DoorGraph]:
    method = "doorGraph()"
    build = _cached_build(model)
    if build.graph is None:
        return _refuse(build, method)
    graph = build.graph
    from_ = [ref.global_id for ref in graph.nodes if ref.global_id != OUTSIDE]
    from_ += [edge.global_id for edge in graph.edges]
    if build.provenance == "declared":
        return declared(graph, from_=from_, method=method, caveat=build.caveat)
    return computed(graph, from_=from_, method=method, caveat=build.caveat)


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

    nodes = [model.ref(space) for space in spaces]
    nodes.append(OUTSIDE_REF)
    known = {space.GlobalId for space in spaces}

    edges: list[DoorEdge] = []
    unresolved: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    derived_any = False

    for door in sorted(doors, key=lambda d: d.GlobalId):
        predefined = getattr(door, "PredefinedType", None)
        predefined = str(predefined) if predefined is not None else None
        if predefined in NON_TRAVERSABLE_DOOR_TYPES:
            excluded.append(
                {
                    "globalId": door.GlobalId,
                    "name": model.label(door),
                    "ifcType": door.is_a(),
                    "predefinedType": predefined,
                    "why": (
                        "PredefinedType = TRAPDOOR: eine Boden- oder Deckenluke connects zwar, ist aber "
                        "nicht begehbar — ein Fluchtweg führt nicht über eine Leiter."
                    ),
                }
            )
            continue

        touching = op.opens_to(model, door.GlobalId)
        if not touching.decidable or touching.value is None:
            unresolved.append(
                {
                    "globalId": door.GlobalId,
                    "name": model.label(door),
                    "ifcType": door.is_a(),
                    "why": touching.missing.what if touching.missing else "opensTo() war nicht entscheidbar",
                    "remedy": touching.missing.remedy if touching.missing else None,
                }
            )
            continue
        if touching.provenance != "declared":
            derived_any = True

        via = "IfcRelSpaceBoundary" if touching.provenance == "declared" else "geom.tree.select"
        rooms = sorted({ref.global_id for ref in touching.value if ref.kind == "space" and ref.global_id in known})

        if not rooms:
            excluded.append(
                {
                    "globalId": door.GlobalId,
                    "name": model.label(door),
                    "ifcType": door.is_a(),
                    "why": (
                        "Diese Tür berührt keinen der modellierten Räume. Sie connects in dieser Datei "
                        "nichts — möglicherweise fehlt der Raum dahinter im Export."
                    ),
                }
            )
            continue

        if len(rooms) == 1:
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
                continue
            edges.append(
                DoorEdge(
                    global_id=door.GlobalId,
                    name=model.label(door),
                    ifc_type=door.is_a(),
                    predefined_type=predefined,
                    a=rooms[0],
                    b=OUTSIDE,
                    length=_leg(model, rooms[0], door.GlobalId),
                    external=True,
                    via=f"{via} + {why}",
                )
            )
            continue

        ambiguous = len(rooms) > 2
        for i, first in enumerate(rooms):
            for second in rooms[i + 1 :]:
                edges.append(
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
                )

    if not model.contacts_complete:
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


_Search = tuple[dict[str, tuple[float, int]], dict[str, tuple[str, DoorEdge]]]


def _search(graph: DoorGraph, start: str, unweighted: bool = False) -> _Search:
    edges = graph.edges if unweighted else [edge for edge in graph.edges if edge.length is not None]
    adjacency: dict[str, list[tuple[str, DoorEdge]]] = {}
    for edge in edges:
        adjacency.setdefault(edge.a, []).append((edge.b, edge))
        adjacency.setdefault(edge.b, []).append((edge.a, edge))

    best: dict[str, tuple[float, int]] = {start: (0.0, 0)}
    came: dict[str, tuple[str, DoorEdge]] = {}
    queue: list[tuple[float, int, str]] = [(0.0, 0, start)]
    while queue:
        cost, hops, node = heapq.heappop(queue)
        if (cost, hops) > best.get(node, (math.inf, 0)):
            continue
        for other, edge in sorted(adjacency.get(node, []), key=lambda pair: pair[0]):
            step = 1.0 if unweighted else float(edge.length or 0.0)
            candidate = (cost + step, hops + 1)
            if candidate < best.get(other, (math.inf, 0)):
                best[other] = candidate
                came[other] = (node, edge)
                heapq.heappush(queue, (candidate[0], candidate[1], other))
    return best, came


def _route(came: dict[str, tuple[str, DoorEdge]], start: str, goal: str) -> list[DoorEdge]:
    edges: list[DoorEdge] = []
    cursor = goal
    while cursor != start:
        previous, edge = came[cursor]
        edges.append(edge)
        cursor = previous
    edges.reverse()
    return edges


def _shortest(graph: DoorGraph, start: str, goal: str) -> tuple[list[DoorEdge], float | None] | None:
    if start == goal:
        return [], 0.0
    best, came = _search(graph, start)
    if goal in best:
        return _route(came, start, goal), best[goal][0]
    best, came = _search(graph, start, unweighted=True)
    if goal in best:
        return _route(came, start, goal), None
    return None


def egress_path(model: SpatialModel, space_global_id: str) -> Answer[dict[str, Any]]:
    method = f"egressPath({space_global_id})"
    subject = op._require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        op._wrong_kind(
            subject,
            method,
            "egressPath",
            "einen Raum (IfcSpace)",
            "für eine Tür: opensTo() liefert die Räume, die sie connects",
        )

    build = _cached_build(model)
    if build.graph is None:
        return _refuse(build, method)
    graph = build.graph

    found = _shortest(graph, space_global_id, OUTSIDE)
    if found is None:
        return undecidable(
            from_=[space_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="eine Türverbindung von diesem Raum bis ins Freie",
                remedy=(
                    "In diesem Export führt von diesem Raum aus keine Kette von Türen nach außen. Das kann "
                    "zweierlei heißen und die Datei unterscheidet es nicht: entweder fehlen Türen (IfcDoor "
                    "mit Raumbezug — im CAD prüfen, ob die Türen exportiert und den Räumen zugeordnet sind), "
                    "oder der Weg führt über eine Treppe, eine Rampe oder eine Öffnung ohne Türblatt, und "
                    "solche Verbindungen sind in einem Türgraph nicht enthalten. reachableFrom() zeigt, "
                    "welche Räume von hier aus überhaupt erreichbar sind."
                ),
                elements=[space_global_id],
            ),
        )

    route, total = found
    legs: list[dict[str, Any]] = []
    node = space_global_id
    by_id = {ref.global_id: ref for ref in graph.nodes}
    for edge in route:
        other = edge.b if edge.a == node else edge.a
        legs.append(
            {
                "from": by_id[node].to_dict(),
                "door": {
                    "globalId": edge.global_id,
                    "name": edge.name,
                    "ifcType": edge.ifc_type,
                    "external": edge.external,
                    "via": edge.via,
                },
                "to": by_id[other].to_dict(),
                "length": None if edge.length is None else round(edge.length, 3),
            }
        )
        node = other

    caveat = _POLYLINE_CAVEAT + " " + _ENDPOINT_CAVEAT + " " + _CENTROID_CAVEAT + " " + (build.caveat or "")
    if total is None:
        caveat += (
            " Für diesen Weg ist KEINE Länge angegeben: mindestens ein Raum oder eine Tür auf der Strecke "
            "trägt in dieser Datei keinen auswertbaren Körper. Die Abfolge der Räume und Türen stimmt "
            "trotzdem — nur die Entfernung fehlt."
        )

    value = {
        "space": model.ref(subject).to_dict(),
        "reachesOutside": True,
        "doorCount": len(route),
        "length": None if total is None else round(total, 3),
        "legs": legs,
        "spaces": [space_global_id, *[leg["to"]["globalId"] for leg in legs if leg["to"]["globalId"] != OUTSIDE]],
        "doors": [edge.global_id for edge in route],
    }
    return computed(
        value,
        unit="m",
        tolerance=None if total is None else len(route) * op.DIMENSION_TOLERANCE,
        from_=[space_global_id, *[edge.global_id for edge in route]],
        method=method,
        caveat=caveat.strip(),
    )


def reachable_from(model: SpatialModel, space_global_id: str) -> Answer[dict[str, Any]]:
    method = f"reachableFrom({space_global_id})"
    subject = op._require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        op._wrong_kind(
            subject,
            method,
            "reachableFrom",
            "einen Raum (IfcSpace)",
            "für eine Tür: opensTo() liefert die Räume, die sie connects",
        )

    build = _cached_build(model)
    if build.graph is None:
        return _refuse(build, method)
    graph = build.graph

    by_hops, _ = _search(graph, space_global_id, unweighted=True)
    by_length, _ = _search(graph, space_global_id)
    by_id = {ref.global_id: ref for ref in graph.nodes}

    reachable: list[dict[str, Any]] = []
    for node, (count, _) in sorted(by_hops.items(), key=lambda item: (item[1][0], item[0])):
        if node in (space_global_id, OUTSIDE):
            continue
        metres = by_length.get(node)
        reachable.append(
            {
                **by_id[node].to_dict(),
                "hops": int(count),
                "length": None if metres is None else round(metres[0], 3),
            }
        )

    unreachable = [ref.to_dict() for ref in graph.nodes if ref.global_id not in by_hops and ref.global_id != OUTSIDE]

    outside_route = _shortest(graph, space_global_id, OUTSIDE)
    outside: dict[str, Any] = {"reachable": outside_route is not None}
    if outside_route is not None:
        outside["doorCount"] = len(outside_route[0])
        outside["length"] = None if outside_route[1] is None else round(outside_route[1], 3)

    caveat = _STRUCTURE_CAVEAT + " " + (build.caveat or "")
    if outside_route is None:
        caveat += (
            " Von diesem Raum aus erreicht keine Türkette das Freie. Das ist eine Aussage über den "
            "Türgraph dieses Exports, nicht über das Gebäude: Treppen, Rampen und türlose Durchgänge sind "
            "hier keine Verbindungen. egressPath() nennt für denselben Fall, was zu ergänzen wäre."
        )
    if unreachable:
        caveat += (
            f" {len(unreachable)} Raum/Räume dieses Modells sind von hier aus über keine Tür erreichbar; "
            "sie stehen unter „nichtErreichbar“. Auch das ist zuerst ein Befund über den Export."
        )
    caveat += " " + _POLYLINE_CAVEAT

    value = {
        "space": model.ref(subject).to_dict(),
        "reachable": reachable,
        "nichtErreichbar": unreachable,
        "outside": outside,
    }
    return computed(
        value,
        from_=[space_global_id, *[entry["globalId"] for entry in reachable]],
        method=method,
        caveat=caveat.strip(),
    )


def _refuse(build: _Build, method: str) -> Answer[Any]:
    return undecidable(
        from_=build.from_,
        method=method,
        provenance=build.provenance,  # type: ignore[arg-type]
        missing=build.missing,  # type: ignore[arg-type]
    )


__all__ = [
    "NON_TRAVERSABLE_DOOR_TYPES",
    "OUTSIDE",
    "OUTSIDE_REF",
    "DoorEdge",
    "DoorGraph",
    "door_graph",
    "egress_path",
    "reachable_from",
]
