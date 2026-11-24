from __future__ import annotations

from typing import Any

import ifcopenshell.util.shape as us
import numpy as np

from ifc_spatial.operators_constants import AREA_RELATIVE_TOLERANCE
from ifc_spatial.operators_constants import DIMENSION_TOLERANCE
from ifc_spatial.operators_guards import _geometry_or_answer
from ifc_spatial.operators_guards import _require

from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import triangulate
from .envelope import undecidable
from .geometry import dominant_vertical_plane
from .geometry import triangle_normals_areas
from .model import SpatialModel


def extent(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"extent({global_id})"
    subject = _require(model, global_id, method)
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    low, high = us.get_bbox(geo.verts)
    width, depth, height = (high - low).tolist()

    caveat = None
    normal = dominant_vertical_plane(geo.triangles)
    if normal is not None and abs(normal[0]) > 0.1 and abs(normal[1]) > 0.1:
        caveat = (
            "Dieses Bauteil steht schräg zu den Modellachsen. Breite und Tiefe sind die Ausdehnung der "
            "achsparallelen Hüllbox, NICHT Länge und Dicke des Bauteils selbst — diese Zahlen sind für ein "
            "schräges Bauteil systematisch zu groß."
        )

    return computed(
        {
            "box": {"min": low.tolist(), "max": high.tolist()},
            "width": width,
            "depth": depth,
            "height": height,
            "centroid": geo.centroid.tolist(),
        },
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[global_id],
        method=method,
        caveat=caveat,
    )


def floor_area(model: SpatialModel, global_id: str, declared_area: float | None = None) -> Answer[float]:
    subject_id = global_id
    method = (
        f"floorArea({subject_id})" if declared_area is None else f"floorArea({subject_id}, declared={declared_area})"
    )
    subject = _require(model, global_id, method)
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    measured, reason = _measured_floor_area(geo.triangles, global_id, method)

    found = None
    declared_method = f"NetFloorArea({global_id})"
    declared_caveat = None
    if declared_area is None:
        names = ("NetFloorArea", "GrossFloorArea")
        if model.kind_of(subject) == "space":
            names = ("NetFloorArea", "NetArea", "GrossFloorArea", "Area")
        found = model.declared_quantity(subject, names)
        if found is None:
            return measured
        declared_area = found.value
        declared_method = f"{found.path}({global_id})"
        if found.scale != 1.0:
            compared = " Verglichen wird in Metern." if measured.decidable else ""
            declared_caveat = (
                f"Die Datei deklariert {found.raw:.4f} {found.unit_label or '(Einheit der Datei)'}; "
                f"umgerechnet {found.value:.4f} m².{compared}"
            )
    else:
        declared_area = float(declared_area)

    answer = triangulate(
        measured,
        declared(declared_area, unit="m²", from_=[global_id], method=declared_method),
        method=method,
    )
    if not measured.decidable:
        unmeasured = (
            f"Grundfläche aus der Geometrie nicht messbar: {_FOOTPRINT_FAILURES[reason]}. "
            "Der Wert ist die deklarierte Fläche, nicht nachgemessen."
        )
        answer.caveat = f"{answer.caveat} {unmeasured}" if answer.caveat else unmeasured
    if declared_caveat:
        answer.caveat = f"{answer.caveat} {declared_caveat}" if answer.caveat else declared_caveat
    return answer


def _measured_floor_area(triangles: np.ndarray, global_id: str, method: str) -> tuple[Answer[float], str]:
    area, reason = _footprint(triangles)
    if reason in _FOOTPRINT_FAILURES:
        measured = undecidable(
            from_=[global_id],
            method=method,
            missing=MissingFact(
                what=f"Grundfläche: {_FOOTPRINT_FAILURES[reason]}",
                remedy="Geometrie des Bauteils im Modell prüfen.",
                elements=[global_id],
            ),
            provenance="computed",
        )
        return measured, reason
    caveat = None
    if reason == "no_horizontal":
        caveat = (
            "Gemessene Grundfläche 0 m²: dieses Bauteil hat Geometrie, aber keine horizontalen Flächen "
            "(eine Wand, ein Pfosten). Das ist ein Messergebnis, keine fehlende Angabe."
        )
    measured = computed(
        area,
        unit="m²",
        tolerance=abs(area) * AREA_RELATIVE_TOLERANCE,
        from_=[global_id],
        method=method,
        caveat=caveat,
    )
    return measured, reason


def _vector_text(value: Any) -> str:
    try:
        return "[" + ", ".join(f"{float(c):.3f}" for c in value) + "]"
    except TypeError, ValueError:
        return repr(value)


_FOOTPRINT_FAILURES = {
    "no_triangles": "die Geometrie des Bauteils enthält keine Dreiecke",
    "invalid_triangles": "die Dreiecke des Bauteils sind ungültig oder ohne Fläche",
    "geos_error": "die Flächenvereinigung ist fehlgeschlagen",
}


def _footprint(triangles: np.ndarray) -> tuple[float, str]:
    if triangles is None or len(triangles) == 0:
        return 0.0, "no_triangles"
    normals, _ = triangle_normals_areas(triangles)
    if not normals.any():
        return 0.0, "invalid_triangles"
    best, saw_facing, errored = _facing_union_area(triangles, normals)
    if errored:
        return 0.0, "geos_error"
    if best > 0:
        return best, "measured"
    if not saw_facing:
        return 0.0, "no_horizontal"
    return 0.0, "invalid_triangles"


def _facing_union_area(triangles: np.ndarray, normals: np.ndarray) -> tuple[float, bool, bool]:
    import shapely
    import shapely.ops

    best = 0.0
    saw_facing = False
    errored = False
    for sign in (1.0, -1.0):
        facing = triangles[normals[:, 2] * sign > 0.01]
        if len(facing) == 0:
            continue
        saw_facing = True
        polygons = []
        for tri in facing:
            polygon = shapely.Polygon(tri[:, :2])
            if polygon.is_valid and polygon.area > 0:
                polygons.append(polygon)
        if not polygons:
            continue
        try:
            best = max(best, float(shapely.ops.unary_union(polygons).area))
        except Exception:
            errored = True
            continue
    return best, saw_facing, errored


def _footprint_area(triangles: np.ndarray) -> float:
    if triangles is None or len(triangles) == 0:
        return 0.0
    normals, _ = triangle_normals_areas(triangles)
    area, _, _ = _facing_union_area(triangles, normals)
    return area
