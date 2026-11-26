from __future__ import annotations

from typing import Any

from . import operators as op
from .circulation_graph import _STRUCTURE_CAVEAT
from .circulation_graph import _Build
from .circulation_graph import _cached_build
from .circulation_records import NON_TRAVERSABLE_DOOR_TYPES
from .circulation_records import OUTSIDE
from .circulation_records import OUTSIDE_REF
from .circulation_records import DoorEdge
from .circulation_records import DoorGraph
from .circulation_routes import _search
from .circulation_routes import _shortest
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import undecidable
from .model import SpatialModel

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

_ENDPOINT_CAVEAT = (
    "Die letzte Teilstrecke endet an der Außentür, nicht an einem sicheren Ort im Freien: außerhalb des "
    "Gebäudes gibt es keinen IfcSpace und damit keinen Punkt, auf den gemessen werden könnte."
)

_CENTROID_CAVEAT = (
    "Gemessen wird auf den flächengewichteten Schwerpunkt des Raumkörpers. Bei L-förmigen oder anderweitig "
    "nicht konvexen Räumen kann dieser Punkt außerhalb des Raums liegen."
)


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
        return _no_way_out(space_global_id, method)

    route, total = found
    legs = _legs(graph, space_global_id, route)

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


def _no_way_out(space_global_id: str, method: str) -> Answer[dict[str, Any]]:
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


def _legs(graph: DoorGraph, start: str, route: list[DoorEdge]) -> list[dict[str, Any]]:
    legs: list[dict[str, Any]] = []
    node = start
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
    return legs


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
    reachable = _reachable(graph, space_global_id, by_hops, by_length)

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


def _reachable(
    graph: DoorGraph,
    start: str,
    by_hops: dict[str, tuple[float, int]],
    by_length: dict[str, tuple[float, int]],
) -> list[dict[str, Any]]:
    by_id = {ref.global_id: ref for ref in graph.nodes}
    reachable: list[dict[str, Any]] = []
    for node, (count, _) in sorted(by_hops.items(), key=lambda item: (item[1][0], item[0])):
        if node in (start, OUTSIDE):
            continue
        metres = by_length.get(node)
        reachable.append(
            {
                **by_id[node].to_dict(),
                "hops": int(count),
                "length": None if metres is None else round(metres[0], 3),
            }
        )
    return reachable


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
