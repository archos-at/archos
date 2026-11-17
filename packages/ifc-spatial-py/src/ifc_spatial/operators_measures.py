from __future__ import annotations

from typing import Any

import ifcopenshell.util.shape as us
import numpy as np

from ifc_spatial.operators_constants import AREA_RELATIVE_TOLERANCE
from ifc_spatial.operators_constants import DIMENSION_TOLERANCE
from ifc_spatial.operators_guards import _geometry_or_answer
from ifc_spatial.operators_guards import _require

from .envelope import Answer
from .envelope import computed
from .envelope import declared
from .envelope import triangulate
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

    area = _footprint_area(geo.triangles)
    caveat = None
    if area == 0:
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
            declared_caveat = (
                f"Die Datei deklariert {found.raw:.4f} {found.unit_label or '(Einheit der Datei)'}; "
                f"umgerechnet {found.value:.4f} m². Verglichen wird in Metern."
            )
    else:
        declared_area = float(declared_area)

    answer = triangulate(
        measured,
        declared(declared_area, unit="m²", from_=[global_id], method=declared_method),
        method=method,
    )
    if declared_caveat:
        answer.caveat = f"{answer.caveat} {declared_caveat}" if answer.caveat else declared_caveat
    return answer


def _vector_text(value: Any) -> str:
    try:
        return "[" + ", ".join(f"{float(c):.3f}" for c in value) + "]"
    except TypeError, ValueError:
        return repr(value)


def _footprint_area(triangles: np.ndarray) -> float:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return 0.0
    normals, _ = triangle_normals_areas(triangles)
    best = 0.0
    for sign in (1.0, -1.0):
        facing = triangles[normals[:, 2] * sign > 0.01]
        if len(facing) == 0:
            continue
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
            continue
    return best
