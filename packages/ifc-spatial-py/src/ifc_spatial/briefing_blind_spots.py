from __future__ import annotations

from ifc_spatial.briefing_reading import _georeferenced
from ifc_spatial.briefing_reading import _hosts_of
from ifc_spatial.briefing_reading import _products_with_representation
from ifc_spatial.briefing_records import BlindSpot
from ifc_spatial.briefing_rooms import _by_type
from ifc_spatial.briefing_rooms import _spaces_of

from .model import SpatialModel



def find_blind_spots(model: SpatialModel, dialect_sample: int | None = None) -> list[BlindSpot]:
    spots: list[BlindSpot] = []
    spaces = len(_spaces_of(model))
    fillers = len(_by_type(model, "IfcWindow")) + len(_by_type(model, "IfcDoor"))
    boundaries = len(_by_type(model, "IfcRelSpaceBoundary"))
    fills = len(_by_type(model, "IfcRelFillsElement"))

    if spaces == 0:
        spots.append(
            BlindSpot(
                what="keine IfcSpace-Elemente",
                consequence="Raumflächen, Raumtiefen und alles je Aufenthaltsraum sind nicht ableitbar",
                remedy="Räume im CAD als IfcSpace exportieren",
            )
        )
    if boundaries == 0 and spaces > 0:
        spots.append(
            BlindSpot(
                what="keine IfcRelSpaceBoundary",
                consequence=(
                    "welche Wände einen Raum begrenzen und welche Räume aneinandergrenzen ist nicht deklariert"
                ),
                remedy=("Space Boundaries (2nd level) mitexportieren — in Revit/ArchiCAD eine Exporteinstellung"),
            )
        )
    if fills == 0 and fillers > 0:
        spots.append(
            BlindSpot(
                what="keine IfcRelFillsElement",
                consequence=f"{fillers} Fenster/Türen lassen sich keiner Wand zuordnen",
                remedy="Öffnungen und Füllungen mitexportieren",
            )
        )
    elif fillers > 0:
        unresolved = sum(1 for e in [*_by_type(model, "IfcWindow"), *_by_type(model, "IfcDoor")] if not _hosts_of(e))
        if unresolved > 0:
            spots.append(
                BlindSpot(
                    what=f"{unresolved} von {fillers} Fenstern/Türen ohne auflösbare Wandzuordnung",
                    consequence=(
                        "für diese Öffnungen ist hostedIn() nicht beantwortbar — die Datei schreibt "
                        "IfcRelFillsElement, aber nicht für sie"
                    ),
                    remedy="Öffnungen und Füllungen für ALLE Fenster/Türen mitexportieren",
                )
            )
    if model.true_north is None:
        spots.append(
            BlindSpot(
                what="keine Nordrichtung",
                consequence="Fassadenorientierung (Süd/Nord) ist nicht bestimmbar",
                remedy="TrueNorth im IfcGeometricRepresentationContext setzen",
            )
        )
    if not _georeferenced(model):
        spots.append(
            BlindSpot(
                what="keine Georeferenzierung",
                consequence=(
                    "Sonnenstand und Besonnung sind nicht berechenbar (der geometrische 45°-Nachweis bleibt möglich)"
                ),
                remedy="IfcMapConversion bzw. RefLatitude/RefLongitude setzen",
            )
        )
    spots.extend(_geometry_blind_spots(model))
    if dialect_sample is not None:
        spots.append(
            BlindSpot(
                what=f"Dialekt aus einer Stichprobe von {dialect_sample} Bauteilen",
                consequence="Befüllungsgrade sind Anteile der Stichprobe, nicht des Modells",
                remedy="dialect_sample_size erhöhen",
            )
        )
    return spots


def _geometry_blind_spots(model: SpatialModel) -> list[BlindSpot]:
    if model.geometry_seconds <= 0:
        with_body = _products_with_representation(model)
        if with_body == 0:
            return [
                BlindSpot(
                    what="keine Körpergeometrie in dieser Datei (kein IfcProduct trägt eine Representation)",
                    consequence=(
                        "Abstände, lichte Maße, Auskragungen, Flächen aus Geometrie und der freie "
                        "Lichteinfall sind aus dieser Datei NICHT berechenbar — auch nicht nach einem "
                        "Geometrie-Pass. Der Export enthält nur Topologie und Eigenschaften"
                    ),
                    remedy=(
                        "Das Modell mit Körpergeometrie neu exportieren (Body-Repräsentation, kein reiner "
                        "Struktur- bzw. Eigenschaftsexport)"
                    ),
                )
            ]
        return [
            BlindSpot(
                what="Geometrie-Pass noch nicht gelaufen (nur Topologie gelesen)",
                consequence=(
                    "Abstände, lichte Maße, Auskragungen, Flächen aus Geometrie und der freie Lichteinfall "
                    f"sind noch nicht berechnet — sie sind aber berechenbar, {with_body} Bauteil(e) in "
                    "diesem Export tragen Geometrie"
                ),
                remedy=(
                    "measure/distance aufrufen — der Geometrie-Pass läuft dann automatisch "
                    "(einmalig ~2 s für ein Einfamilienhaus)"
                ),
            )
        ]

    spots: list[BlindSpot] = []
    spaces = _spaces_of(model)
    without_solid = [s for s in spaces if model.geometry(s.GlobalId) is None]
    if spaces and without_solid:
        spots.append(
            BlindSpot(
                what=f"{len(without_solid)} von {len(spaces)} Räumen ohne Volumenkörper",
                consequence=(
                    "für diese Räume sind Grundfläche, lichte Höhe und die aus Geometrie abgeleiteten "
                    "Raumbegrenzungen nicht bestimmbar — die Räume existieren, ihre Geometrie wurde nicht "
                    "exportiert oder nicht ausgewertet"
                ),
                remedy="Räume mit Körpergeometrie (Body-Representation) exportieren",
            )
        )
    return spots
