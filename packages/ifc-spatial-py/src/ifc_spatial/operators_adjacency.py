from __future__ import annotations

from typing import Any

from ifc_spatial.operators_bounds import _too_big_to_derive
from ifc_spatial.operators_bounds import bounds
from ifc_spatial.operators_constants import _DERIVED_BOUNDARY_CAVEAT
from ifc_spatial.operators_constants import _HORIZONTAL_SEPARATORS
from ifc_spatial.operators_constants import CONTACT
from ifc_spatial.operators_guards import _has
from ifc_spatial.operators_guards import _no_geometry
from ifc_spatial.operators_guards import _relation_missing
from ifc_spatial.operators_guards import _require
from ifc_spatial.operators_guards import _wrong_kind

from .envelope import Answer
from .envelope import ElementRef
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import undecidable
from .model import CONTACT_BUDGET_SECONDS
from .model import SpatialModel


def enclosed_by(model: SpatialModel, element_global_id: str) -> Answer[list[ElementRef]]:
    method = f"enclosedBy({element_global_id})"
    subject = _require(model, element_global_id, method)
    if model.kind_of(subject) == "space":
        _wrong_kind(
            subject,
            method,
            "enclosedBy",
            "ein Bauteil (Wand, Decke, Fenster)",
            "für einen Raum: bounds() liefert die begrenzenden Bauteile, adjacentSpaces() die Nachbarräume",
        )

    provides = [
        rel.RelatingSpace for rel in (getattr(subject, "ProvidesBoundaries", []) or []) if rel.RelatingSpace is not None
    ]
    if provides:
        return declared(
            model.refs(provides),
            from_=[element_global_id, *[s.GlobalId for s in provides]],
            method=method,
        )

    spaces = _spaces_touching(model, subject, method)
    if isinstance(spaces, Answer):
        return spaces
    return computed(
        model.refs(spaces, via="geom.tree.select"),
        from_=[element_global_id, *[s.GlobalId for s in spaces]],
        method=method,
        caveat=_DERIVED_BOUNDARY_CAVEAT.format(contact=CONTACT),
    )


def _spaces_touching(model: SpatialModel, subject: Any, method: str) -> Any:
    if not model.derivable_boundaries:
        return _too_big_to_derive(model, method, subject.GlobalId)
    if model.geometry(subject.GlobalId) is None:
        return _no_geometry(model, subject, method)
    contacts = model.space_contacts(CONTACT)
    if not model.contacts_complete:
        total = len(model.file.by_type("IfcSpace"))
        return undecidable(
            from_=[subject.GlobalId],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="IfcRelSpaceBoundary (die Ableitung aus der Geometrie ist für dieses Modell zu teuer)",
                remedy=(
                    f"Dieser Export enthält keine Raumgrenzen, und die Ableitung aus den Körpern wurde nach "
                    f"{model.contacts_covered} von {total} Räumen abgebrochen (Zeitbudget "
                    f"{int(CONTACT_BUDGET_SECONDS)} s). Eine unvollständige Liste wäre nicht von einer "
                    "vollständigen zu unterscheiden, deshalb wird keine ausgegeben. Abhilfe: Space Boundaries "
                    "(2nd level) mitexportieren — in Revit/ArchiCAD eine Exporteinstellung — oder die "
                    "Auswertung dieses Modells in einem Worker ohne Anfragezeitlimit fahren."
                ),
                elements=[subject.GlobalId],
            ),
        )
    return [model.file.by_guid(space_id) for space_id, touching in contacts.items() if subject.GlobalId in touching]


def opens_to(model: SpatialModel, global_id: str) -> Answer[list[ElementRef]]:
    method = f"opensTo({global_id})"
    subject = _require(model, global_id, method)
    if model.kind_of(subject) not in ("element", "opening"):
        _wrong_kind(
            subject,
            method,
            "opensTo",
            "ein Fenster oder eine Tür",
            "für einen Raum: adjacentSpaces() liefert die Nachbarräume",
        )

    provides = [
        rel.RelatingSpace for rel in (getattr(subject, "ProvidesBoundaries", []) or []) if rel.RelatingSpace is not None
    ]
    if provides:
        return declared(model.refs(provides), from_=[global_id, *[s.GlobalId for s in provides]], method=method)

    if not model.file.by_type("IfcSpace"):
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="IfcSpace",
                remedy=(
                    "Dieser Export enthält keine Räume. Räume im CAD als IfcSpace exportieren — ohne sie "
                    "ist keine Zuordnung Fenster→Raum ableitbar."
                ),
            ),
        )

    spaces = _spaces_touching(model, subject, method)
    if isinstance(spaces, Answer):
        return spaces
    return computed(
        model.refs(spaces, via="geom.tree.select"),
        from_=[global_id, *[s.GlobalId for s in spaces]],
        method=method,
        caveat=_DERIVED_BOUNDARY_CAVEAT.format(contact=CONTACT),
    )


def contains(model: SpatialModel, container_global_id: str) -> Answer[list[ElementRef]]:
    method = f"contains({container_global_id})"
    subject = _require(model, container_global_id, method)
    if model.kind_of(subject) not in ("project", "site", "building", "storey", "space"):
        _wrong_kind(
            subject,
            method,
            "contains",
            "einen räumlichen Container (Geschoss, Raum, Gebäude)",
            "für ein Bauteil: containerOf() liefert seinen Container, hosts() seine Öffnungen",
        )
    if not _has(model, "IfcRelContainedInSpatialStructure"):
        return undecidable(
            from_=[container_global_id], method=method, missing=_relation_missing(model, ["containsElement"])
        )

    elements = [e for rel in (getattr(subject, "ContainsElements", []) or []) for e in rel.RelatedElements]
    aggregated = [e for rel in (getattr(subject, "IsDecomposedBy", []) or []) for e in rel.RelatedObjects]
    caveat = None
    if aggregated:
        caveat = (
            f"Zusätzlich hängen {len(aggregated)} Objekt(e) über IfcRelAggregates an diesem Container "
            "(Räume, Baugruppen). Die stehen nicht in dieser Liste — contains() zeigt nur die räumliche "
            "Zuordnung IfcRelContainedInSpatialStructure."
        )
    return declared(
        model.refs(elements),
        from_=[container_global_id, *[e.GlobalId for e in elements]],
        method=method,
        caveat=caveat,
    )


def container_of(model: SpatialModel, global_id: str) -> Answer[ElementRef | None]:
    method = f"containerOf({global_id})"
    subject = _require(model, global_id, method)
    if not _has(model, "IfcRelContainedInSpatialStructure"):
        return undecidable(from_=[global_id], method=method, missing=_relation_missing(model, ["containsElement"]))

    containers = [rel.RelatingStructure for rel in (getattr(subject, "ContainedInStructure", []) or [])]
    if not containers:
        return declared(None, from_=[global_id], method=method)

    caveat = None
    if len(containers) > 1:
        caveat = (
            f"Dieses Bauteil ist {len(containers)} räumlichen Containern zugeordnet, IFC erlaubt genau einen. "
            "Gemeldet ist der erste — ein Befund über den Export."
        )
    return declared(
        model.ref(containers[0]),
        from_=[global_id, containers[0].GlobalId],
        method=method,
        caveat=caveat,
    )


def _separates_horizontally_only(model: SpatialModel, global_id: str) -> bool:
    try:
        element = model.file.by_guid(global_id)
    except RuntimeError, KeyError:
        return False
    return any(element.is_a(name) for name in _HORIZONTAL_SEPARATORS)


def adjacent_spaces(model: SpatialModel, space_global_id: str) -> Answer[list[ElementRef]]:
    method = f"adjacentSpaces({space_global_id})"
    subject = _require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        _wrong_kind(
            subject,
            method,
            "adjacentSpaces",
            "einen Raum (IfcSpace)",
            "für ein Bauteil: enclosedBy() liefert die Räume, die es begrenzt",
        )

    own = bounds(model, space_global_id)
    if not own.decidable or own.value is None:
        return own
    own_ids = {ref.global_id for ref in own.value}

    neighbours: list[Any] = []
    stacked: list[Any] = []
    for other in model.file.by_type("IfcSpace"):
        if other.GlobalId == space_global_id:
            continue
        other_bounds = bounds(model, other.GlobalId)
        if not other_bounds.decidable or other_bounds.value is None:
            continue
        shared = own_ids & {ref.global_id for ref in other_bounds.value}
        if not shared:
            continue
        if not any(_separates_horizontally_only(model, gid) is False for gid in shared):
            stacked.append(other)
            continue
        neighbours.append(other)

    declared_inputs = own.provenance == "declared"
    refs = model.refs(neighbours, via="shared separating element")
    caveat = (
        "Nachbarschaft heißt gemeinsames TRENNENDES Bauteil, NICHT begehbare Verbindung — dafür "
        "egressPath. Rein waagrecht getrennte Räume (gemeinsame Geschoßdecke) sind ausgenommen; "
        "übereinanderliegende Räume liefert above/below."
    )
    if declared_inputs:
        caveat = (
            "Die Raumbegrenzungen sind deklariert (IfcRelSpaceBoundary); die Nachbarschaft daraus ist "
            "gefolgert, nicht deklariert. " + caveat
        )
    else:
        caveat = _DERIVED_BOUNDARY_CAVEAT.format(contact=CONTACT) + " " + caveat
    if stacked:
        caveat += f" {len(stacked)} Raum/Räume berühren diesen nur über eine waagrechte Trennung."
    return computed(
        refs,
        from_=[space_global_id, *[s.GlobalId for s in neighbours]],
        method=method,
        caveat=caveat,
    )
