from __future__ import annotations

from typing import Any

from ifc_spatial.briefing_constants import KIND_LABEL
from ifc_spatial.briefing_constants import RoomUseKind
from ifc_spatial.briefing_lexicon import LEXICON
from ifc_spatial.briefing_records import RoomProposal
from ifc_spatial.briefing_rooms import _by_type
from ifc_spatial.briefing_rooms import _spaces_of
from ifc_spatial.briefing_rooms import _window_assignment
from ifc_spatial.briefing_rooms import classify_rooms

from .envelope import Answer
from .envelope import MissingFact
from .envelope import declared
from .envelope import inferred
from .envelope import undecidable
from .model import SpatialModel
from .model import Storey


def storey_heights(model: SpatialModel) -> Answer[list[dict[str, Any]]]:
    method = "storeyHeights(model)"
    ordered = _sorted_storeys(model)
    with_elevation = [s for s in ordered if s.elevation is not None]
    missing_elevation = len(ordered) - len(with_elevation)

    if len(with_elevation) < 2:
        return undecidable(
            from_=[s.global_id for s in ordered],
            provenance="declared",
            method=method,
            missing=MissingFact(
                what="IfcBuildingStorey.Elevation",
                remedy=(
                    "Das Modell enthält keine IfcBuildingStorey. Geschoße im CAD anlegen und mitexportieren."
                    if not ordered
                    else (
                        "Mindestens zwei Geschoße müssen eine Höhenlage (Elevation) deklarieren. "
                        "Im CAD die Geschoßhöhen setzen und neu exportieren."
                    )
                ),
                elements=[s.global_id for s in ordered],
            ),
        )

    value: list[dict[str, Any]] = []
    for index, storey in enumerate(with_elevation):
        nxt = with_elevation[index + 1] if index + 1 < len(with_elevation) else None
        value.append(
            {
                "storey": storey.name or storey.global_id,
                "elevation": storey.elevation,
                "height": None if nxt is None else round((nxt.elevation - storey.elevation) * 1000) / 1000,  # type: ignore[operator]
            }
        )

    caveat = [
        "Rohbau-Geschoßhöhe von Geschoßoberkante zu Geschoßoberkante, gebildet aus den deklarierten "
        "Höhenlagen. Kein Deckenaufbau und keine Deckenstärke abgezogen — das ist NICHT die lichte "
        "Raumhöhe und nicht für einen Raumhöhennachweis verwendbar.",
        f"Das oberste Geschoß ({value[-1]['storey'] if value else '—'}) hat keine nächste Höhenlage; "
        "seine Höhe bleibt offen statt geschätzt.",
    ]
    if missing_elevation > 0:
        caveat.append(
            f"{missing_elevation} Geschoß(e) ohne deklarierte Höhenlage sind nicht enthalten — die Liste ist "
            "kein vollständiges Geschoßverzeichnis."
        )
    suspicious = sum(1 for entry in value if entry["height"] is not None and entry["height"] <= 0)
    if suspicious > 0:
        caveat.append(
            f"{suspicious} Geschoßübergang(e) ergeben eine Höhe ≤ 0 — zwei Geschoße mit gleicher oder "
            "fallender Höhenlage. Das ist ein Befund über den Export, nicht über das Gebäude."
        )

    return declared(
        value,
        unit="m",
        from_=[s.global_id for s in with_elevation],
        method=method,
        caveat=" ".join(caveat),
    )


def inventory(model: SpatialModel, kind: RoomUseKind) -> Answer[list[RoomProposal]]:
    method = f"inventory(model, '{kind}')"
    spaces = _spaces_of(model)

    if not spaces:
        return undecidable(
            from_=[],
            method=method,
            provenance="inferred",
            missing=MissingFact(
                what="IfcSpace",
                remedy=(
                    "Dieser Export enthält keine Räume. Räume im CAD als IfcSpace exportieren — ohne sie ist "
                    "keine Raumnutzung ableitbar, weder aus Namen noch aus Geometrie."
                ),
            ),
        )

    classified = classify_rooms(model)
    matching = [room for room in classified if room.kind == kind]
    unnamed = sum(1 for room in classified if room.name is None)
    unclassified = sum(1 for room in classified if room.kind is None)

    value = [
        RoomProposal(global_id=room.global_id, name=room.name, confidence=room.confidence, because=list(room.because))
        for room in matching
    ]

    because = [
        f"Einstufung aus dem Raumnamen gegen ein deutsch/österreichisch-englisches Lexikon ({len(LEXICON)} Einträge), "
        "Groß-/Kleinschreibung und Umlautvarianten (Küche/Kueche/KÜCHE) vereinheitlicht.",
        "Bei mehreren Treffern gewinnt der längere Begriff (Waschküche vor Küche).",
        f"{len(matching)} von {len(spaces)} Räumen als {KIND_LABEL[kind]} vorgeschlagen.",
    ]
    lit_source = _window_assignment(model)
    if lit_source is not None:
        because.append("Fensterzuordnung (opensTo) als Zusatzsignal, wo der Export sie hergibt.")
    else:
        because.append(
            "Keine Fensterzuordnung im Modell — die Einstufung stützt sich allein auf den Namen, nicht auf Belichtung."
        )

    caveat = [
        "Aufenthaltsraum ist eine RECHTLICHE Einstufung nach der Nutzung, keine geometrische Eigenschaft. "
        "Diese Liste ist ein Vorschlag aus Raumnamen und muss von einem Menschen bestätigt werden — sie "
        "ist kein Nachweis und keine Feststellung.",
    ]
    if unnamed > 0:
        caveat.append(f"{unnamed} Raum/Räume tragen keinen Namen und konnten gar nicht eingestuft werden.")
    if unclassified > unnamed:
        caveat.append(
            f"{unclassified - unnamed} weitere Raumnamen passen zu keinem Lexikoneintrag — ein Befund über die "
            "Raumbenennung im Export, nicht über die Nutzung."
        )
    if not value:
        caveat.append(
            f"Kein Raumname in diesem Modell deutet auf {KIND_LABEL[kind]} hin. Das heißt nicht, dass das "
            "Gebäude keine hat — es heißt, dass die Benennung im Export nichts dazu sagt."
        )

    mean = 0.0 if not value else round(sum(r.confidence for r in value) / len(value) * 100) / 100

    return inferred(
        value,
        from_=[room.global_id for room in value],
        method=method,
        confidence=mean,
        because=because,
        caveat=" ".join(caveat),
    )


def _products_with_representation(model: SpatialModel) -> int:
    try:
        products = model.file.by_type("IfcProduct")
    except RuntimeError:
        return 0
    return sum(1 for product in products if getattr(product, "Representation", None))


def _georeferenced(model: SpatialModel) -> bool:
    try:
        return bool(model.georeferenced)
    except RuntimeError:
        return False


def _nodes_of(model: SpatialModel) -> list[Any]:
    return [*_by_type(model, "IfcProject"), *_by_type(model, "IfcProduct"), *_by_type(model, "IfcGroup")]


def _sorted_storeys(model: SpatialModel) -> list[Storey]:
    return sorted(model.storeys, key=lambda s: (s.elevation is None, s.elevation if s.elevation is not None else 0.0))


def _heights_of(model: SpatialModel) -> dict[str, float]:
    answer = storey_heights(model)
    out: dict[str, float] = {}
    if not answer.decidable or answer.value is None:
        return out
    for index, entry in enumerate(answer.value):
        if index < len(answer.from_) and entry["height"] is not None:
            out[answer.from_[index]] = entry["height"]
    return out


def _hosts_of(element: Any) -> list[Any]:
    return [
        rel.RelatingBuildingElement
        for fills in (getattr(element, "FillsVoids", None) or [])
        for rel in (getattr(fills.RelatingOpeningElement, "VoidsElements", None) or [])
        if rel.RelatingBuildingElement is not None
    ]


def _declared_boundaries(space: Any) -> list[Any]:
    return [
        rel.RelatedBuildingElement
        for rel in (getattr(space, "BoundedBy", None) or [])
        if rel.RelatedBuildingElement is not None
    ]


def _entity_count(model: SpatialModel) -> int:
    try:
        return len(list(model.file))
    except Exception:
        return 0


def _edge_count(model: SpatialModel) -> int:
    total = 0
    for ifc_type, attribute in (
        ("IfcRelContainedInSpatialStructure", "RelatedElements"),
        ("IfcRelAggregates", "RelatedObjects"),
        ("IfcRelVoidsElement", None),
        ("IfcRelFillsElement", None),
        ("IfcRelSpaceBoundary", None),
        ("IfcRelConnectsPathElements", None),
        ("IfcRelConnectsElements", None),
    ):
        try:
            instances = model.file.by_type(ifc_type)
        except RuntimeError:
            continue
        if attribute is None:
            total += len(instances)
            continue
        for rel in instances:
            total += len(getattr(rel, attribute, None) or ())
    return total
