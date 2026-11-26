from __future__ import annotations

from typing import Any

import numpy as np

from .envelope import Answer
from .envelope import computed
from .envelope import declared
from .envelope import triangulate
from .envelope_geometry_survey import KIND_ORDER
from .envelope_geometry_survey import ROUTE_BOUNDED_SPACES
from .envelope_geometry_survey import ROUTE_DECLARED
from .envelope_geometry_survey import ROUTE_UNDECIDED
from .envelope_geometry_survey import SLOPE_REPORT_FRACTION
from .envelope_geometry_survey import TRANSPARENT_TYPES
from .envelope_geometry_survey import _survey
from .envelope_geometry_texts import _compactness_caveat
from .envelope_geometry_texts import _no_envelope
from .envelope_geometry_texts import _no_measured_area
from .envelope_geometry_texts import _no_measured_envelope
from .envelope_geometry_texts import _no_volume
from .envelope_geometry_texts import _orientation_caveat
from .envelope_geometry_texts import _orientation_notes
from .envelope_geometry_texts import _thermal_caveat
from .envelope_geometry_texts import _zero_volume
from .model import SpatialModel
from .operators import AREA_RELATIVE_TOLERANCE
from .operators import COMPASS
from .operators import azimuth

VOLUME_RELATIVE_TOLERANCE = 1.5 * AREA_RELATIVE_TOLERANCE


def thermal_envelope(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "thermalEnvelope()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    inside = [e for e in surveyed if e["external"] is False]
    unknown = [e for e in surveyed if e["external"] is None]
    if not outside:
        return _no_envelope(method, surveyed)

    by_kind: dict[str, list[dict[str, Any]]] = {}
    area_by_kind: dict[str, float] = {}
    for entry in outside:
        by_kind.setdefault(entry["kind"], []).append(entry)
        if entry["area"] is not None:
            area_by_kind[entry["kind"]] = round(area_by_kind.get(entry["kind"], 0.0) + entry["area"], 6)

    measured = [e for e in outside if e["area"] is not None]
    without_area = [e for e in outside if e["area"] is None]
    total = round(sum(e["area"] for e in measured), 6) if measured else None

    routes: dict[str, int] = {}
    for entry in outside:
        routes[entry["route"]] = routes.get(entry["route"], 0) + 1
    caveat = _thermal_caveat(model, inside, without_area, unknown)

    return computed(
        {
            "byKind": {kind: by_kind[kind] for kind in KIND_ORDER if kind in by_kind},
            "areaByKind": area_by_kind,
            "totalArea": total,
            "elementCount": len(outside),
            "routes": routes,
            "interior": inside,
            "undetermined": unknown,
        },
        unit="m²",
        tolerance=abs(total) * AREA_RELATIVE_TOLERANCE if total else None,
        from_=[e["globalId"] for e in outside],
        method=method,
        caveat=caveat,
    )


def envelope_area_by_orientation(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "envelopeAreaByOrientation()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    if not outside:
        return _no_envelope(method, surveyed)

    measured = [e for e in outside if e["area"] is not None]
    if not measured:
        return _no_measured_area(method, outside)

    vertical = [e for e in measured if e["horizontal"] is False]
    horizontal = [e for e in measured if e["horizontal"] is not False]
    opaque_total = round(sum(e["area"] for e in measured if not e["transparent"]), 6)
    transparent_total = round(sum(e["area"] for e in measured if e["transparent"]), 6)
    whole = opaque_total + transparent_total

    payload: dict[str, Any] = {
        "orientationKnown": model.true_north is not None,
        "opaque": opaque_total,
        "transparent": transparent_total,
        "total": round(whole, 6),
        "windowWallRatio": round(transparent_total / whole, 6) if whole > 0 else None,
        "ohneAusrichtung": [
            {"globalId": e["globalId"], "name": e["name"], "kind": e["kind"], "area": e["area"]} for e in horizontal
        ],
    }
    caveat = _orientation_caveat(model, horizontal)
    if model.true_north is None:
        return computed(
            payload,
            unit="m²",
            tolerance=abs(whole) * AREA_RELATIVE_TOLERANCE,
            from_=[e["globalId"] for e in measured],
            method=method,
            caveat=caveat,
        )
    by_orientation, unoriented = _by_orientation(model, vertical)
    caveat += _orientation_notes(by_orientation, unoriented)

    payload["byOrientation"] = {name: by_orientation[name] for name in COMPASS if name in by_orientation}
    payload["ohneHimmelsrichtung"] = unoriented
    return computed(
        payload,
        unit="m²",
        tolerance=abs(whole) * AREA_RELATIVE_TOLERANCE,
        from_=[e["globalId"] for e in measured],
        method=method,
        caveat=caveat,
    )


def _by_orientation(
    model: SpatialModel, vertical: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    by_orientation: dict[str, dict[str, Any]] = {}
    unoriented: list[dict[str, Any]] = []
    for entry in vertical:
        bearing = azimuth(model, entry["globalId"])
        if not bearing.decidable or bearing.value is None:
            unoriented.append({"globalId": entry["globalId"], "name": entry["name"], "area": entry["area"]})
            continue
        bucket = by_orientation.setdefault(
            bearing.value["compass"],
            {"opaque": 0.0, "transparent": 0.0, "total": 0.0, "windowWallRatio": None, "elements": []},
        )
        bucket["transparent" if entry["transparent"] else "opaque"] += entry["area"]
        bucket["elements"].append(
            {
                "globalId": entry["globalId"],
                "name": entry["name"],
                "kind": entry["kind"],
                "area": entry["area"],
                "degrees": round(float(bearing.value["degrees"]), 3),
                "transparent": entry["transparent"],
            }
        )

    for bucket in by_orientation.values():
        bucket["opaque"] = round(bucket["opaque"], 6)
        bucket["transparent"] = round(bucket["transparent"], 6)
        bucket["total"] = round(bucket["opaque"] + bucket["transparent"], 6)
        bucket["windowWallRatio"] = round(bucket["transparent"] / bucket["total"], 6) if bucket["total"] > 0 else None
    return by_orientation, unoriented


def _space_volume(model: SpatialModel, space: Any) -> float | None:
    geometry = model.geometry(space.GlobalId)
    if geometry is None or len(geometry.triangles) == 0:
        return None
    triangles = geometry.triangles
    signed = np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2]))
    return float(abs(signed.sum()) / 6.0)


def compactness(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "compactness()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    if not outside:
        return _no_envelope(method, surveyed)

    measured = [e for e in outside if e["area"] is not None]
    without_area = [e for e in outside if e["area"] is None]
    if not measured:
        return _no_measured_envelope(method, outside)
    area = round(sum(e["area"] for e in measured), 6)

    spaces = model.file.by_type("IfcSpace")
    volumes, without_body, declared_total, declared_count = _space_volumes(model, spaces)

    if not volumes:
        return _no_volume(method, measured, spaces)

    volume_answer, volume_total = _volume_answer(volumes, declared_total, declared_count)
    volume = float(volume_answer.value) if volume_answer.value is not None else volume_total

    ratio = area / volume if volume > 0 else None
    if ratio is None:
        return _zero_volume(method, measured)

    caveat = _compactness_caveat(model, measured, volumes, volume_answer, without_area, without_body, spaces)

    return computed(
        {
            "ratio": round(ratio, 6),
            "characteristicLength": round(volume / area, 6),
            "envelopeArea": area,
            "volume": round(volume, 6),
            "volumeIs": "netto (Raumkörper, bis zu den inneren Oberflächen)",
            "volumeAgreement": volume_answer.agreement,
            "areaByKind": {
                kind: round(sum(e["area"] for e in measured if e["kind"] == kind), 6)
                for kind in KIND_ORDER
                if any(e["kind"] == kind for e in measured)
            },
            "spaces": volumes,
            "elementCount": len(measured),
        },
        unit="1/m",
        tolerance=abs(ratio) * (AREA_RELATIVE_TOLERANCE + VOLUME_RELATIVE_TOLERANCE),
        from_=[e["globalId"] for e in measured] + [v["globalId"] for v in volumes],
        method=method,
        caveat=caveat,
    )


def _space_volumes(model: SpatialModel, spaces: Any) -> tuple[list[dict[str, Any]], list[Any], float, int]:
    volumes: list[dict[str, Any]] = []
    without_body: list[Any] = []
    declared_total = 0.0
    declared_count = 0
    for space in spaces:
        volume = _space_volume(model, space)
        found = model.declared_quantity(space, ("NetVolume", "GrossVolume"))
        if volume is None:
            without_body.append(space)
            continue
        if found is not None:
            declared_total += found.value
            declared_count += 1
        volumes.append(
            {
                "globalId": space.GlobalId,
                "name": model.label(space),
                "volume": round(volume, 6),
                "declaredVolume": None if found is None else round(found.value, 6),
                "declaredAt": None if found is None else found.path,
            }
        )
    return volumes, without_body, declared_total, declared_count


def _volume_answer(
    volumes: list[dict[str, Any]], declared_total: float, declared_count: int
) -> tuple[Answer[Any], float]:
    volume_total = round(sum(v["volume"] for v in volumes), 6)
    measured_volume = computed(
        volume_total,
        unit="m³",
        tolerance=abs(volume_total) * VOLUME_RELATIVE_TOLERANCE,
        from_=[v["globalId"] for v in volumes],
        method=f"Σ Raumkörper ({len(volumes)} IfcSpace)",
    )
    volume_answer = measured_volume
    if declared_count == len(volumes) and declared_count > 0:
        volume_answer = triangulate(
            measured_volume,
            declared(
                round(declared_total, 6),
                unit="m³",
                from_=[v["globalId"] for v in volumes],
                method=f"Σ deklarierte Raumvolumina ({declared_count} IfcSpace)",
            ),
            method=f"Σ Raumkörper ({len(volumes)} IfcSpace)",
        )
    return volume_answer, volume_total


__all__ = [
    "KIND_ORDER",
    "ROUTE_BOUNDED_SPACES",
    "ROUTE_DECLARED",
    "ROUTE_UNDECIDED",
    "SLOPE_REPORT_FRACTION",
    "TRANSPARENT_TYPES",
    "VOLUME_RELATIVE_TOLERANCE",
    "compactness",
    "envelope_area_by_orientation",
    "thermal_envelope",
]
