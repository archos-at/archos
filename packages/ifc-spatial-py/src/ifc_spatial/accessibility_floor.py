from __future__ import annotations

from typing import Any

import numpy as np

from ifc_spatial.accessibility_constants import _VERTICAL_HOSTS
from ifc_spatial.accessibility_constants import BUFFER_QUAD_SEGS
from ifc_spatial.accessibility_constants import CONTACT_EXTEND
from ifc_spatial.accessibility_constants import FLOOR_CONTACT
from ifc_spatial.accessibility_constants import FREE_FLOOR_MAX_TRIANGLES
from ifc_spatial.accessibility_constants import INSCRIBED_STEPS
from ifc_spatial.accessibility_constants import MIN_OBSTACLE_AREA
from ifc_spatial.accessibility_constants import OUTSIDE_PROBE
from ifc_spatial.accessibility_constants import PROBE_LIFT
from ifc_spatial.accessibility_records import _Frame
from ifc_spatial.accessibility_records import _FreeFloor

from .envelope import Answer
from .envelope import MissingFact
from .envelope import undecidable
from .geometry import PARALLEL_DOT
from .geometry import VERTICAL_TOLERANCE
from .geometry import dominant_vertical_plane
from .geometry import triangle_normals_areas
from .model import AIR_TYPES
from .model import SpatialModel
from .operators import COORDINATE_TOLERANCE
from .operators import FURNISHING


def _plan_footprint(triangles: np.ndarray) -> Any | None:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return None
    normals, _ = triangle_normals_areas(triangles)
    best = None
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
            union = shapely.ops.unary_union(polygons)
        except Exception:
            continue
        if best is None or union.area > best.area:
            best = union
    return best


def _plan_silhouette(triangles: np.ndarray) -> Any | None:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return None
    polygons = []
    for tri in triangles:
        polygon = shapely.Polygon(tri[:, :2])
        if polygon.is_valid and polygon.area > 1e-9:
            polygons.append(polygon)
    if not polygons:
        return None
    try:
        return shapely.ops.unary_union(polygons)
    except Exception:
        return None


def _is_furnishing(element: Any) -> bool:
    for kind in FURNISHING:
        try:
            if element.is_a(kind):
                return True
        except Exception:
            continue
    return False


def _largest_circle(polygon: Any) -> tuple[float, tuple[float, float]] | None:
    if polygon is None or polygon.is_empty or polygon.area <= 0:
        return None
    min_x, min_y, max_x, max_y = polygon.bounds
    low = 0.0
    high = max(max_x - min_x, max_y - min_y) / 2.0 + COORDINATE_TOLERANCE
    best = None
    for _ in range(INSCRIBED_STEPS):
        mid = (low + high) / 2.0
        eroded = polygon.buffer(-mid, quad_segs=BUFFER_QUAD_SEGS)
        if eroded.is_empty or eroded.area <= 0:
            high = mid
        else:
            low = mid
            best = eroded
    if best is None:
        return None
    centre = best.representative_point()
    return low, (float(centre.x), float(centre.y))


def _free_floor(model: SpatialModel, space: Any, skip: set[str] | None = None) -> _FreeFloor | Answer[Any] | None:
    geo = model.geometry(space.GlobalId)
    if geo is None:
        return None
    footprint = _plan_footprint(geo.triangles)
    if footprint is None or footprint.is_empty:
        return None

    floor_z = float(geo.box[0][2])
    free = _FreeFloor(footprint, floor_z)
    skip = skip or set()

    for element in model.tree.select_box(space, extend=CONTACT_EXTEND):
        global_id = getattr(element, "GlobalId", None)
        if not global_id or global_id == space.GlobalId or global_id in skip:
            continue
        if element.is_a() in AIR_TYPES:
            continue
        other = model.geometry(global_id)
        if other is None:
            continue
        if not (float(other.box[0][2]) <= floor_z + FLOOR_CONTACT < float(other.box[1][2])):
            continue
        free.triangles += len(other.triangles)
        if free.triangles > FREE_FLOOR_MAX_TRIANGLES:
            return _too_many_triangles(model, space, free.triangles)
        silhouette = _plan_silhouette(other.triangles)
        if silhouette is None:
            continue
        try:
            intruding = silhouette.intersection(footprint)
        except Exception:
            continue
        if intruding.area <= MIN_OBSTACLE_AREA:
            continue
        loose = _is_furnishing(element)
        free.furnished = free.furnished.difference(silhouette)
        if not loose:
            free.fixed = free.fixed.difference(silhouette)
        free.obstacles.append(
            {
                "globalId": global_id,
                "name": model.label(element),
                "ifcType": element.is_a(),
                "area": round(float(intruding.area), 4),
                "counts": "furnished" if loose else "fixed",
            }
        )

    free.obstacles.sort(key=lambda o: (-o["area"], o["globalId"]))
    return free


def _too_many_triangles(model: SpatialModel, space: Any, count: int) -> Answer[Any]:
    name = model.label(space) or space.GlobalId
    return undecidable(
        from_=[space.GlobalId],
        method=f"freieBodenfläche({space.GlobalId})",
        provenance="computed",
        missing=MissingFact(
            what=f"die freie Bodenfläche von „{name}“ ist für diese Auswertung zu fein tesselliert",
            remedy=(
                f"In diesem Raum stehen Bauteile mit zusammen über {count} Dreiecken. Die Grundrissprojektion "
                f"wird ab {FREE_FLOOR_MAX_TRIANGLES} Dreiecken nicht begonnen, weil ihre Laufzeit überlinear "
                "wächst und eine Anfrage sonst nicht zurückkommt. Abhilfe: das Modell mit gröberer "
                "Tessellierung exportieren, oder diesen Raum in einem Worker ohne Anfragezeitlimit auswerten."
            ),
            elements=[space.GlobalId],
        ),
    )


def _facing_area(triangles: np.ndarray, normal: np.ndarray) -> float:
    normals, areas = triangle_normals_areas(triangles)
    facing = (np.abs(normals[:, 2]) < VERTICAL_TOLERANCE) & (np.abs(normals[:, :2] @ normal) >= PARALLEL_DOT)
    return float(areas[facing].sum())


def _is_floor_void(model: SpatialModel, element: Any, geo: Any) -> bool:
    from .operators import hosted_in

    normal3 = dominant_vertical_plane(geo.triangles)
    if normal3 is not None:
        normal = np.array([float(normal3[0]), float(normal3[1])])
        length = float(np.linalg.norm(normal))
        if length >= 1e-9:
            normal = normal / length
            lateral = np.array([-normal[1], normal[0]])
            points = geo.verts[:, :2]
            across = points @ lateral
            through = points @ normal
            plan = float(across.max() - across.min()) * float(through.max() - through.min())
            if plan <= _facing_area(geo.triangles, normal):
                return False

    host = hosted_in(model, element.GlobalId)
    if host.decidable and host.value:
        hosting = model.file.by_guid(host.value[0].global_id)
        if any(hosting.is_a(name) for name in _VERTICAL_HOSTS):
            return False
    return True


def _frame_of(model: SpatialModel, element: Any) -> _Frame | None:
    from .operators import hosted_in

    geo = model.geometry(element.GlobalId)
    if geo is None or len(geo.triangles) == 0:
        return None
    normal3 = dominant_vertical_plane(geo.triangles)
    if normal3 is None:
        return None
    normal = np.array([float(normal3[0]), float(normal3[1])])
    length = float(np.linalg.norm(normal))
    if length < 1e-9:
        return None
    if _is_floor_void(model, element, geo):
        return None
    normal = normal / length
    frame = _Frame(normal, np.array([-normal[1], normal[0]]))

    points = geo.verts[:, :2]
    across = points @ frame.lateral
    through = points @ frame.normal
    frame.u_min, frame.u_max = float(across.min()), float(across.max())
    frame.v_min, frame.v_max = float(through.min()), float(through.max())
    frame.z_min, frame.z_max = float(geo.box[0][2]), float(geo.box[1][2])

    host = hosted_in(model, element.GlobalId)
    if host.decidable and host.value:
        host_geo = model.geometry(host.value[0].global_id)
        if host_geo is not None:
            host_through = host_geo.verts[:, :2] @ frame.normal
            frame.host_min = float(host_through.min())
            frame.host_max = float(host_through.max())
    return frame


def _no_plane(model: SpatialModel, element: Any, method: str) -> Answer[Any]:
    name = model.label(element) or element.GlobalId
    return undecidable(
        from_=[element.GlobalId],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=f"keine senkrechte Öffnungsebene an {element.is_a()} „{name}“",
            remedy=(
                "Diese Messung braucht die Ebene der Öffnung, um „davor“ und „dahinter“ überhaupt zu "
                "definieren. Dieses Bauteil hat entweder keinen Körper im Export, oder es liegt waagrecht "
                "(ein Dachflächenfenster in einem Flachdach) und hat damit keine senkrechte Ebene. Abhilfe: "
                "den Export mit Körpergeometrie sowie mit Öffnungen und Füllungen wiederholen."
            ),
            elements=[element.GlobalId],
        ),
    )


def _spaces_by_side(model: SpatialModel, element: Any, frame: _Frame) -> dict[float, Any]:
    from .operators import opens_to

    found: dict[float, Any] = {}
    answer = opens_to(model, element.GlobalId)
    if not answer.decidable or not answer.value:
        return found
    for ref in answer.value:
        geo = model.geometry(ref.global_id)
        if geo is None:
            continue
        through = float(np.array(geo.centroid[:2]) @ frame.normal)
        sign = 1.0 if through > (frame.v_min + frame.v_max) / 2.0 else -1.0
        found.setdefault(sign, model.file.by_guid(ref.global_id))
    return found


def _surface_below(model: SpatialModel, x: float, y: float, z: float) -> tuple[float, Any] | None:
    point = (float(x), float(y), float(z))
    occupying = [
        e
        for e in model.tree.select(point)
        if getattr(e, "GlobalId", None) and e.is_a() not in AIR_TYPES and not _is_furnishing(e)
    ]
    if occupying:
        best = None
        for element in occupying:
            geo = model.geometry(element.GlobalId)
            if geo is None:
                continue
            top = float(geo.box[1][2])
            if best is None or top > best[0]:
                best = (top, element)
        if best is not None:
            return best

    hits = sorted(
        model.tree.select_ray(point, (0.0, 0.0, -1.0), length=model.diagonal),
        key=lambda h: float(h.distance),
    )
    for hit in hits:
        element = model.file.by_id(hit.instance.id())
        if element.is_a() in AIR_TYPES or _is_furnishing(element):
            continue
        return float(point[2]) - float(hit.distance), element
    return None


def _standing_level(model: SpatialModel, element: Any, frame: _Frame, sign: float, space: Any | None) -> dict[str, Any]:
    from .daylight import below

    entry: dict[str, Any] = {
        "direction": [round(float(frame.normal[0] * sign), 4), round(float(frame.normal[1] * sign), 4)],
        "space": None,
        "spaceName": None,
        "level": None,
        "via": None,
        "surface": None,
    }
    if space is not None:
        geo = model.geometry(space.GlobalId)
        if geo is not None:
            entry["space"] = space.GlobalId
            entry["spaceName"] = model.label(space)
            entry["level"] = round(float(geo.box[0][2]), 4)
            entry["via"] = "Unterkante des Raumkörpers (IfcSpace)"
            under = below(model, space.GlobalId, samples=3)
            if under.decidable and under.value:
                nearest = under.value[0]
                entry["surface"] = {
                    "globalId": nearest["globalId"],
                    "name": nearest["name"],
                    "ifcType": nearest["ifcType"],
                    "top": round(float(entry["level"]) - float(nearest["gap"]), 4),
                    "gap": nearest["gap"],
                }
            return entry

    face = frame.outer_face(sign)
    plan = frame.point(frame.u_centre, face + sign * OUTSIDE_PROBE)
    found = _surface_below(model, float(plan[0]), float(plan[1]), frame.z_min + PROBE_LIFT)
    if found is None:
        return entry
    level, hit = found
    entry["level"] = round(level, 4)
    entry["via"] = f"Strahl nach unten, {OUTSIDE_PROBE:.2f} m vor der Öffnung (kein IfcSpace auf dieser Seite)"
    entry["surface"] = {
        "globalId": hit.GlobalId,
        "name": model.label(hit),
        "ifcType": hit.is_a(),
        "top": round(level, 4),
        "gap": None,
    }
    return entry


def _levels_both_sides(model: SpatialModel, element: Any, frame: _Frame) -> list[dict[str, Any]]:
    spaces = _spaces_by_side(model, element, frame)
    return [_standing_level(model, element, frame, sign, spaces.get(sign)) for sign in (1.0, -1.0)]
