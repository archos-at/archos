from __future__ import annotations

from typing import Any

import ifcopenshell.util.element as ue

from .envelope import Answer
from .envelope import ElementRef
from .envelope import MissingFact
from .envelope import declared
from .envelope import undecidable
from .model import SpatialModel
from .operators import _RELATIONS
from .operators import _wrong_kind


def connects(model: SpatialModel, global_id: str) -> Answer[list[ElementRef]]:
    method = f"connects({global_id})"
    subject = model.by_id(global_id, method)

    if not _has(model, "IfcRelConnectsElements") and not _has(model, "IfcRelConnectsPathElements"):
        return undecidable(
            from_=[global_id],
            method=method,
            missing=MissingFact(what=_RELATIONS["connects"][0], remedy=_RELATIONS["connects"][1]),
        )

    found: dict[str, Any] = {}
    for rel in getattr(subject, "ConnectedTo", None) or []:
        other = getattr(rel, "RelatedElement", None)
        if other is not None and other.GlobalId != global_id:
            found[other.GlobalId] = other
    for rel in getattr(subject, "ConnectedFrom", None) or []:
        other = getattr(rel, "RelatingElement", None)
        if other is not None and other.GlobalId != global_id:
            found[other.GlobalId] = other

    if not found:
        connected = _connected_types(model)
        if not any(subject.is_a(name) for name in connected):
            return _no_connections_for_this_type(subject, connected, method)

    ordered = [found[key] for key in sorted(found)]
    return declared(model.refs(ordered), from_=[global_id, *[e.GlobalId for e in ordered]], method=method)


def _connected_types(model: SpatialModel) -> frozenset[str]:
    cached = getattr(model, "_connected_types", None)
    if cached is not None:
        return cached
    names: set[str] = set()
    for relation_type in ("IfcRelConnectsElements", "IfcRelConnectsPathElements"):
        try:
            relations = model.file.by_type(relation_type)
        except RuntimeError:
            continue
        for relation in relations:
            for attribute in ("RelatingElement", "RelatedElement"):
                element = getattr(relation, attribute, None)
                if element is not None:
                    names.add(element.is_a())
    frozen = frozenset(names)
    model._connected_types = frozen  # type: ignore[attr-defined]
    return frozen


def _no_connections_for_this_type(subject: Any, connected: frozenset[str], method: str) -> Answer[Any]:
    written = ", ".join(sorted(connected)) if connected else "keine"
    return undecidable(
        from_=[subject.GlobalId],
        method=method,
        missing=MissingFact(
            what=(
                f"{_RELATIONS['connects'][0]} für {subject.is_a()} — diese Datei schreibt Bauteil"
                f"verbindungen ausschließlich für: {written}. Für {subject.is_a()} steht in keiner einzigen "
                "Verbindungsbeziehung ein Bauteil, weder auf der einen noch auf der anderen Seite."
            ),
            remedy=(
                f"Dass hier nichts steht, heißt NICHT, dass dieses Bauteil an nichts anschließt: der Export "
                f"legt für {subject.is_a()} überhaupt keine Verbindungen an. ArchiCAD etwa schreibt nur "
                "Wand-an-Wand. Abhilfe: den Export mit Bauteilverbindungen für alle Bauteilarten wiederholen "
                "(IfcRelConnectsElements / IfcRelConnectsPathElements). Bis dahin ist der Anschluss "
                "geometrisch zu prüfen — hostedIn() für ein Bauteil in einer Wand, bounds() für die Bauteile "
                "an einem Raum, distance() für den Abstand zweier Bauteile."
            ),
            elements=[subject.GlobalId],
        ),
    )


def elements_of_storey(model: SpatialModel, storey_global_id: str) -> Answer[list[ElementRef]]:
    method = f"elementsOfStorey({storey_global_id})"
    subject = model.by_id(storey_global_id, method)

    if model.kind_of(subject) != "storey":
        _wrong_kind(
            subject,
            method,
            "elementsOfStorey",
            "ein Geschoss (IfcBuildingStorey)",
            "für einen Raum oder ein Gebäude: contains()",
        )

    if not _has(model, "IfcRelContainedInSpatialStructure") and not _has(model, "IfcRelAggregates"):
        return undecidable(
            from_=[storey_global_id],
            method=method,
            missing=MissingFact(what=_RELATIONS["containsElement"][0], remedy=_RELATIONS["containsElement"][1]),
        )

    seen: dict[str, Any] = {}
    for element in ue.get_decomposition(subject) or []:
        global_id = getattr(element, "GlobalId", None)
        if not global_id or global_id == storey_global_id:
            continue
        seen.setdefault(global_id, element)

    ordered = [seen[key] for key in sorted(seen)]
    return declared(model.refs(ordered), from_=[storey_global_id, *[e.GlobalId for e in ordered]], method=method)


def _has(model: SpatialModel, ifc_type: str) -> bool:
    try:
        return len(model.file.by_type(ifc_type)) > 0
    except RuntimeError:
        return False


__all__ = ["connects", "elements_of_storey"]
