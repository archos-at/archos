from __future__ import annotations

from typing import Any  # noqa: F401

from ifc_spatial.stairs_constants import _RISER_COUNT_NAMES  # noqa: F401
from ifc_spatial.stairs_constants import BURIED_CLEARANCE  # noqa: F401
from ifc_spatial.stairs_constants import BURIED_OVERLAP_FRACTION  # noqa: F401
from ifc_spatial.stairs_constants import FLIGHT_STRAIGHTNESS  # noqa: F401
from ifc_spatial.stairs_constants import FLIGHT_TURN_DEGREES  # noqa: F401
from ifc_spatial.stairs_constants import HEADROOM_LATERAL  # noqa: F401
from ifc_spatial.stairs_constants import HEADROOM_REACH  # noqa: F401
from ifc_spatial.stairs_constants import HEADROOM_SAMPLE_SPACING  # noqa: F401
from ifc_spatial.stairs_constants import HEADROOM_TRANSPARENT  # noqa: F401
from ifc_spatial.stairs_constants import LANDING_AREA_FACTOR  # noqa: F401
from ifc_spatial.stairs_constants import PLAUSIBLE_RISER  # noqa: F401
from ifc_spatial.stairs_constants import RAMP_TYPES  # noqa: F401
from ifc_spatial.stairs_constants import STAIR_TYPES  # noqa: F401
from ifc_spatial.stairs_constants import TREAD_FLATNESS  # noqa: F401
from ifc_spatial.stairs_constants import TREAD_NORMAL_DOT  # noqa: F401
from ifc_spatial.stairs_geometry import stair_geometry  # noqa: F401
from ifc_spatial.stairs_headroom import headroom  # noqa: F401
from ifc_spatial.stairs_ramp import ramp_slope  # noqa: F401
from ifc_spatial.stairs_reading import _flight_parts  # noqa: F401
from ifc_spatial.stairs_reading import _read_body  # noqa: F401
from ifc_spatial.stairs_reading import _sources  # noqa: F401
from ifc_spatial.stairs_treads import _measure_run  # noqa: F401
from ifc_spatial.stairs_treads import _tread_surfaces  # noqa: F401
from ifc_spatial.stairs_treads import _walking_surfaces  # noqa: F401

from .envelope import Answer  # noqa: F401
from .envelope import MissingFact  # noqa: F401
from .envelope import declared  # noqa: F401
from .envelope import undecidable  # noqa: F401
from .model import SpatialModel  # noqa: F401
from .operators import _require  # noqa: F401
from .operators import _wrong_kind  # noqa: F401



def steps_of(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"stepsOf({global_id})"
    subject = _require(model, global_id, method)
    if not (subject.is_a("IfcStair") or subject.is_a("IfcRamp")):
        parent = None
        for rel in getattr(subject, "Decomposes", []) or []:
            parent = rel.RelatingObject
            break
        suggestion = (
            f"dieser Lauf gehört zur Baugruppe {parent.GlobalId} — stepsOf({parent.GlobalId}) liefert deren "
            "Läufe und Podeste"
            if parent is not None and getattr(parent, "GlobalId", None)
            else "für einen einzelnen Lauf: stairGeometry() bzw. rampSlope() misst ihn direkt"
        )
        _wrong_kind(
            subject,
            method,
            "stepsOf",
            "eine Treppe oder eine Rampe als Baugruppe (IfcStair, IfcRamp)",
            suggestion,
        )

    flights, landings, other = _flight_parts(subject)
    risers_per_flight: dict[str, int | None] = {}
    for flight in flights:
        count = model.declared_property(flight, _RISER_COUNT_NAMES)
        risers_per_flight[flight.GlobalId] = (
            int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) else None
        )

    value = {
        "flights": model.refs(flights),
        "landings": model.refs(landings),
        "other": model.refs(other),
        "risersPerFlight": risers_per_flight,
    }

    if not flights:
        return undecidable(
            from_=[global_id],
            method=method,
            missing=MissingFact(
                what=(
                    f"{subject.is_a()} „{model.label(subject) or global_id}“ ist in der Datei nicht in Läufe "
                    "gegliedert: keine IfcRelAggregates-Beziehung auf IfcStairFlight/IfcRampFlight"
                ),
                remedy=(
                    "Das heißt NICHT, dass diese Treppe aus einem einzigen Lauf besteht — mehrere Exporte "
                    "(Revit und ArchiCAD an erster Stelle) schreiben die ganze Treppe als einen Körper. Eine "
                    "Aussage „so viele Steigungen je Lauf ohne Podest“ ist an dieser Datei deshalb nicht zu "
                    "treffen. stairGeometry() misst den Körper und weist die darin erkannten Läufe und "
                    "Podeste aus; als Bauteilbezug bleibt dann aber nur die Treppe selbst. Abhilfe: im CAD "
                    "die Treppe als Treppenbauteil mit einzelnen Läufen (IfcStairFlight) und Podesten "
                    "(IfcSlab mit PredefinedType = LANDING) exportieren."
                ),
                elements=[global_id],
            ),
        )

    undeclared = [gid for gid, count in risers_per_flight.items() if count is None]
    caveat = (
        f"{len(flights)} Läufe und {len(landings)} Podeste, aus IfcRelAggregates gelesen. Podeste sind "
        "über IfcSlab.PredefinedType = LANDING erkannt; ein Podest, das der Export als gewöhnliche Decke "
        "schreibt, steht in other und fehlt in dieser Zählung."
    )
    if undeclared:
        caveat += (
            f" Für {len(undeclared)} der Läufe deklariert die Datei keine Steigungszahl "
            "(Pset_StairFlightCommon.NumberOfRiser) — stairGeometry() zählt sie am Körper nach."
        )

    return declared(
        value,
        from_=_sources(global_id, *[part.GlobalId for part in (*flights, *landings, *other)]),
        method=method,
        caveat=caveat,
    )


__all__ = [
    "BURIED_CLEARANCE",
    "BURIED_OVERLAP_FRACTION",
    "FLIGHT_STRAIGHTNESS",
    "FLIGHT_TURN_DEGREES",
    "HEADROOM_LATERAL",
    "HEADROOM_REACH",
    "HEADROOM_SAMPLE_SPACING",
    "HEADROOM_TRANSPARENT",
    "LANDING_AREA_FACTOR",
    "PLAUSIBLE_RISER",
    "RAMP_TYPES",
    "STAIR_TYPES",
    "TREAD_FLATNESS",
    "TREAD_NORMAL_DOT",
    "headroom",
    "ramp_slope",
    "stair_geometry",
    "steps_of",
]
