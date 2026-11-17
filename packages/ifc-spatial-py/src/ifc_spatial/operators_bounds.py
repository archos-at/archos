from __future__ import annotations

from typing import Any

from ifc_spatial.operators_constants import _DERIVED_BOUNDARY_CAVEAT
from ifc_spatial.operators_constants import _RELATIONS
from ifc_spatial.operators_constants import CONTACT
from ifc_spatial.operators_constants import FENESTRATION
from ifc_spatial.operators_guards import _geometry_or_answer
from ifc_spatial.operators_guards import _has
from ifc_spatial.operators_guards import _relation_missing
from ifc_spatial.operators_guards import _require
from ifc_spatial.operators_guards import _wrong_kind

from .envelope import Answer
from .envelope import ElementRef
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import undecidable
from .model import AIR_TYPES
from .model import DERIVED_BOUNDARY_MAX_PRODUCTS
from .model import SpatialModel



def hosts(model: SpatialModel, global_id: str) -> Answer[list[ElementRef]]:
    method = f"hosts({global_id})"
    subject = _require(model, global_id, method)
    kind = model.kind_of(subject)

    if kind == "opening":
        _wrong_kind(
            subject,
            method,
            "hosts",
            "ein durchbrochenes Bauteil (Wand, Decke)",
            "für eine Öffnung: fillerOf() liefert ihre Füllung",
        )
    if kind != "element":
        _wrong_kind(
            subject,
            method,
            "hosts",
            "ein Bauteil (Wand, Decke)",
            "für Räume: bounds(), für Geschosse: elementsOfStorey()",
        )
    if not _has(model, "IfcRelVoidsElement"):
        return undecidable(from_=[global_id], method=method, missing=_relation_missing(model, ["voids"]))

    openings = [rel.RelatedOpeningElement for rel in getattr(subject, "HasOpenings", []) or []]
    refs = model.refs(openings)
    return declared(refs, from_=[global_id, *[o.GlobalId for o in openings]], method=method)


def filler_of(model: SpatialModel, opening_global_id: str) -> Answer[list[ElementRef]]:
    method = f"fillerOf({opening_global_id})"
    subject = _require(model, opening_global_id, method)
    if model.kind_of(subject) != "opening":
        _wrong_kind(
            subject,
            method,
            "fillerOf",
            "eine Öffnung (IfcOpeningElement)",
            "für ein Bauteil: hosts() liefert seine Öffnungen, hostedIn() das umgebende Bauteil",
        )
    if not _has(model, "IfcRelFillsElement"):
        return undecidable(from_=[opening_global_id], method=method, missing=_relation_missing(model, ["fills"]))

    fillers = [rel.RelatedBuildingElement for rel in getattr(subject, "HasFillings", []) or []]
    return declared(
        model.refs(fillers),
        from_=[opening_global_id, *[e.GlobalId for e in fillers]],
        method=method,
    )


def hosted_in(model: SpatialModel, global_id: str) -> Answer[list[ElementRef]]:
    method = f"hostedIn({global_id})"
    subject = _require(model, global_id, method)
    kind = model.kind_of(subject)

    if kind not in ("element", "opening"):
        _wrong_kind(
            subject,
            method,
            "hostedIn",
            "ein Fenster oder eine Tür",
            "für Räume: bounds(), für Bauteile einer Ebene: elementsOfStorey()",
        )

    absent = [k for k in ("voids", "fills") if not _has(model, _RELATIONS[k][0])]
    if absent:
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=_relation_missing(model, absent),
        )

    if kind == "opening":
        openings = [subject]
    else:
        openings = [rel.RelatingOpeningElement for rel in getattr(subject, "FillsVoids", []) or []]
    hosts_ = [
        rel.RelatingBuildingElement for opening in openings for rel in (getattr(opening, "VoidsElements", []) or [])
    ]

    refs = model.refs(hosts_, via="voids+fills")
    caveat = (
        "Aus zwei deklarierten Beziehungen abgeleitet (voids+fills) — die Datei sagt nirgends direkt, "
        "in welcher Wand dieses Fenster sitzt."
    )
    if not refs and subject.is_a() in FENESTRATION:
        caveat = (
            "Für dieses Bauteil ist in der Datei keine Öffnungskette hinterlegt (IfcRelFillsElement → "
            "IfcRelVoidsElement fehlt), obwohl die Datei solche Ketten grundsätzlich enthält. Das heißt "
            "NICHT, dass das Fenster in keiner Wand sitzt — es heißt, dass dieser Export die Rohbauöffnung "
            "nicht mitgeschrieben hat und die Wand ihren Ausschnitt bereits im Körper trägt. Abhilfe: den "
            "Export mit Öffnungen und Füllungen wiederholen."
        )
    return computed(
        refs,
        from_=[global_id, *[h.GlobalId for h in hosts_]],
        method=method,
        caveat=caveat,
    )


def bounds(model: SpatialModel, space_global_id: str) -> Answer[list[ElementRef]]:
    method = f"bounds({space_global_id})"
    subject = _require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        _wrong_kind(
            subject,
            method,
            "bounds",
            "einen Raum (IfcSpace)",
            "für ein Bauteil: enclosedBy() liefert die Räume, die es begrenzt",
        )

    seen: set[str] = set()
    declared_boundaries = []
    for rel in getattr(subject, "BoundedBy", []) or []:
        element = rel.RelatedBuildingElement
        if element is None or element.GlobalId in seen:
            continue
        seen.add(element.GlobalId)
        declared_boundaries.append(element)
    if declared_boundaries:
        return declared(
            model.refs(declared_boundaries),
            from_=[space_global_id, *[e.GlobalId for e in declared_boundaries]],
            method=method,
        )

    found, answer = _derived_bounds(model, subject, method)
    if answer is not None:
        return answer
    unique = []
    for element in found:
        if element.GlobalId in seen:
            continue
        seen.add(element.GlobalId)
        unique.append(element)
    return computed(
        model.refs(unique, via="geom.tree.select"),
        from_=[space_global_id, *[e.GlobalId for e in unique]],
        method=method,
        caveat=_DERIVED_BOUNDARY_CAVEAT.format(contact=CONTACT),
    )


def _too_big_to_derive(model: SpatialModel, method: str, subject_id: str) -> Answer[Any]:
    return undecidable(
        from_=[subject_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="IfcRelSpaceBoundary",
            remedy=(
                f"Dieser Export enthält für dieses Bauteil keine Raumgrenzen, und das Modell ist mit "
                f"{model.product_count} Bauteilen zu groß, um sie aus den Körpern abzuleiten (Grenze "
                f"{DERIVED_BOUNDARY_MAX_PRODUCTS}). Eine einzelne Verschneidungsabfrage läuft auf einem Modell "
                "dieser Größe über 200 Sekunden und lässt sich nicht abbrechen — deshalb wird sie gar nicht "
                "erst gestartet. Abhilfe: Space Boundaries (2nd level) mitexportieren — in Revit/ArchiCAD eine "
                "Exporteinstellung — oder dieses Modell in einem Worker ohne Anfragezeitlimit auswerten."
            ),
            elements=[subject_id],
        ),
    )


def _derived_bounds(model: SpatialModel, space: Any, method: str) -> tuple[list[Any], Answer[Any] | None]:
    if not model.derivable_boundaries:
        return [], _too_big_to_derive(model, method, space.GlobalId)
    geo, missing = _geometry_or_answer(model, space, method)
    if geo is None:
        return [], missing
    low, high = geo.box
    found: list[Any] = []
    for global_id in sorted(model.contacts_of(space, CONTACT)):
        element = model.file.by_guid(global_id)
        if element.is_a() in AIR_TYPES:
            continue
        other = model.geometry(element.GlobalId)
        if other is None:
            continue
        o_low, o_high = other.box
        if bool((o_low < low - 0.01).any() or (o_high > high + 0.01).any()):
            found.append(element)
    return found, None
