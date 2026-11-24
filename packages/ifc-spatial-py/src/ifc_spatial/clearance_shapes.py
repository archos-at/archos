from __future__ import annotations

from typing import Any

import numpy as np

from .geometry import dominant_vertical_plane
from .geometry import triangle_normals_areas
from .model import SpatialModel


def _aperture_polygon(model: SpatialModel, element: Any) -> tuple[Any, np.ndarray] | None:
    import shapely
    import shapely.ops

    global_id = getattr(element, "GlobalId", None)
    if not global_id:
        return None
    geo = model.geometry(global_id)
    if geo is None or len(geo.triangles) == 0:
        return None
    normal = dominant_vertical_plane(geo.triangles)
    if normal is None:
        return None

    up = np.array([0.0, 0.0, 1.0])
    up = up - normal * float(up @ normal)
    if np.linalg.norm(up) < 1e-9:
        return None
    up = up / np.linalg.norm(up)
    across = np.cross(normal, up)

    normals, _ = triangle_normals_areas(geo.triangles)
    facing = geo.triangles[np.abs(normals @ normal) > 0.9]
    if len(facing) == 0:
        return None

    polygons = []
    for tri in facing:
        flat = shapely.Polygon([(float(p @ across), float(p @ up)) for p in tri])
        if flat.is_valid and flat.area > 0:
            polygons.append(flat)
    if not polygons:
        return None
    try:
        return shapely.ops.unary_union(polygons), normal
    except Exception:
        return None


def _minimum_area_rectangle(points: np.ndarray) -> tuple[float, float, np.ndarray] | None:
    import shapely

    hull = shapely.MultiPoint([(float(p[0]), float(p[1])) for p in points]).convex_hull
    if hull.geom_type != "Polygon":
        return None
    ring = np.asarray(hull.exterior.coords)[:-1]
    if len(ring) < 3:
        return None

    best: tuple[float, float, float, np.ndarray] | None = None
    for i in range(len(ring)):
        edge = ring[(i + 1) % len(ring)] - ring[i]
        length = float(np.linalg.norm(edge))
        if length < 1e-12:
            continue
        along = edge / length
        across = np.array([-along[1], along[0]])
        u = ring @ along
        v = ring @ across
        extent_u = float(u.max() - u.min())
        extent_v = float(v.max() - v.min())
        area = extent_u * extent_v
        if best is None or area < best[0] - 1e-15:
            best = (area, extent_u, extent_v, along)

    if best is None:
        return None
    _, extent_u, extent_v, along = best
    if extent_u >= extent_v:
        return extent_u, extent_v, along
    return extent_v, extent_u, np.array([-along[1], along[0]])
