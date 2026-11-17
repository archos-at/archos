from __future__ import annotations

from typing import Any

import numpy as np

from ifc_spatial.stairs_constants import _RISER_COUNT_NAMES
from ifc_spatial.stairs_records import _Body
from ifc_spatial.stairs_records import _Flight
from ifc_spatial.stairs_treads import _landing_levels
from ifc_spatial.stairs_treads import _measure_run
from ifc_spatial.stairs_treads import _runs
from ifc_spatial.stairs_treads import _tread_surfaces
from ifc_spatial.stairs_treads import _walking_surfaces

from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import triangulate
from .envelope import undecidable
from .model import DeclaredQuantity
from .model import SpatialModel
from .operators import DIMENSION_TOLERANCE


def _sources(*ids: str | None) -> list[str]:
    return list(dict.fromkeys([i for i in ids if i]))


def _read_body(model: SpatialModel, element: Any) -> _Body:
    geo = model.geometry(element.GlobalId)
    if geo is None:
        return _Body(flights=[], landings=0, refusals=[], levels=0)
    clusters = _walking_surfaces(_tread_surfaces(geo))
    if not clusters:
        return _Body(flights=[], landings=0, refusals=[], levels=0)

    landings = _landing_levels(clusters)
    groups = _runs(clusters, landings)
    landing_positions = [index for index, is_landing in enumerate(landings) if is_landing]

    flights: list[_Flight] = []
    refusals: list[str] = []
    for indices, below, above in groups:
        first, last = indices[0], indices[-1]
        landing_under = next((clusters[i] for i in reversed(landing_positions) if i < first), None) if below else None
        landing_over = next((clusters[i] for i in landing_positions if i > last), None) if above else None
        flight, refusal = _measure_run(
            element,
            [clusters[i] for i in indices],
            base_z=float(geo.box[0][2]),
            landing_below=landing_under,
            landing_above=landing_over,
            alone=len(groups) == 1,
        )
        if flight is not None:
            flights.append(flight)
        elif refusal is not None and refusal not in refusals:
            refusals.append(refusal)

    return _Body(flights=flights, landings=len(landing_positions), refusals=refusals, levels=len(clusters))


def _spread(values: list[float]) -> dict[str, float]:
    array = np.array(values, dtype=float)
    return {
        "mean": float(array.mean()),
        "min": float(array.min()),
        "max": float(array.max()),
        "spread": float(array.max() - array.min()),
        "count": int(array.size),
    }




def _declared_count(model: SpatialModel, elements: list[Any]) -> tuple[int | None, str | None]:
    for element in elements:
        value = model.declared_property(element, _RISER_COUNT_NAMES)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        return int(value), element.GlobalId
    return None, None


def _declared_length(
    model: SpatialModel, elements: list[Any], names: tuple[str, ...]
) -> tuple[DeclaredQuantity | None, str | None]:
    for element in elements:
        quantity = model.declared_quantity(element, names)
        if quantity is not None:
            return quantity, element.GlobalId
    return None, None


def _reconcile(
    measured: float | None,
    declared_quantity: DeclaredQuantity | None,
    *,
    subject_id: str,
    declared_on: str | None,
    method: str,
) -> tuple[dict[str, Any], str | None]:
    if measured is None and declared_quantity is None:
        return {"value": None, "declared": None, "agreement": None}, None

    measured_answer = (
        computed(measured, unit="m", tolerance=DIMENSION_TOLERANCE, from_=[subject_id], method=method)
        if measured is not None
        else undecidable(
            from_=[subject_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="dieser Wert ist am Körper nicht messbar",
                remedy="Der Körper zeigt die Flächen nicht, aus denen sich dieser Wert ablesen ließe.",
            ),
        )
    )
    declared_answer = (
        declared(declared_quantity.value, unit="m", from_=[declared_on or subject_id], method=method)
        if declared_quantity is not None
        else undecidable(
            from_=[subject_id],
            method=method,
            missing=MissingFact(
                what="die Datei deklariert diesen Wert nicht",
                remedy=(
                    "Steigungshöhe und Auftritt in Pset_StairCommon bzw. Pset_StairFlightCommon eintragen "
                    "und erneut exportieren."
                ),
            ),
        )
    )
    pair = triangulate(measured_answer, declared_answer, method=method)
    block: dict[str, Any] = {
        "value": pair.value,
        "measured": measured,
        "declared": None if declared_quantity is None else declared_quantity.value,
        "declaredAs": None if declared_quantity is None else declared_quantity.path,
        "agreement": pair.agreement,
    }
    return block, pair.caveat




def _parts_of(element: Any) -> list[Any]:
    out: list[Any] = []
    for rel in getattr(element, "IsDecomposedBy", []) or []:
        for part in rel.RelatedObjects or []:
            if getattr(part, "GlobalId", None):
                out.append(part)
    return out


def _is_landing(element: Any) -> bool:
    if not element.is_a("IfcSlab"):
        return False
    return str(getattr(element, "PredefinedType", "") or "").upper() == "LANDING"


def _flight_parts(element: Any) -> tuple[list[Any], list[Any], list[Any]]:
    flights, landings, other = [], [], []
    for part in _parts_of(element):
        if part.is_a("IfcStairFlight") or part.is_a("IfcRampFlight"):
            flights.append(part)
        elif _is_landing(part):
            landings.append(part)
        else:
            other.append(part)
    return flights, landings, other
