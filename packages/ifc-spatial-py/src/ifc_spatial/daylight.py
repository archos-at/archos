from __future__ import annotations

from typing import Any

import numpy as np

from . import operators as op
from .daylight_depth_notes import _depth_caveat
from .daylight_depth_notes import _no_facade
from .daylight_overhead import above
from .daylight_overhead import below
from .daylight_sun import sun_position
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .geometry import triangle_normals_areas
from .model import SpatialModel

CURTAIN_WALL_TYPES = ("IfcPlate", "IfcMember", "IfcCurtainWall")


def _footprint_points(triangles: np.ndarray) -> np.ndarray | None:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return None
    normals, _ = triangle_normals_areas(triangles)
    best_area = 0.0
    best: Any = None
    for sign in (1.0, -1.0):
        facing = triangles[normals[:, 2] * sign > 0.01]
        if len(facing) == 0:
            continue
        polygons = _valid_polygons(facing)
        if not polygons:
            continue
        try:
            merged = shapely.ops.unary_union(polygons)
        except Exception:
            continue
        if merged.area > best_area:
            best_area = merged.area
            best = merged
    if best is None or best.is_empty:
        return None

    coords: list[tuple[float, float]] = []
    for part in getattr(best, "geoms", [best]):
        exterior = getattr(part, "exterior", None)
        if exterior is None:
            continue
        coords.extend((float(x), float(y)) for x, y in exterior.coords)
        for ring in part.interiors:
            coords.extend((float(x), float(y)) for x, y in ring.coords)
    return np.array(coords) if coords else None


def _valid_polygons(facing: np.ndarray) -> list[Any]:
    import shapely

    polygons = []
    for tri in facing:
        polygon = shapely.Polygon(tri[:, :2])
        if polygon.is_valid and polygon.area > 0:
            polygons.append(polygon)
    return polygons


def _extent_along(points: np.ndarray, direction: np.ndarray) -> float:
    projected = points @ direction
    return float(projected.max() - projected.min())


def _aperture_area(model: SpatialModel, element: Any) -> float | None:
    for rel in getattr(element, "FillsVoids", []) or []:
        area = op._clear_opening_area(model, rel.RelatingOpeningElement)
        if area:
            return area
    return op._clear_opening_area(model, element)


def _facade_candidates(model: SpatialModel, space_global_id: str, bounding: list[Any]) -> list[dict[str, Any]]:
    external: dict[str, dict[str, Any]] = {}
    for element in bounding:
        if model.kind_of(element) != "element":
            continue
        if element.is_a() not in ("IfcWall", "IfcWallStandardCase"):
            continue
        if not _counts_as_external(model, element):
            continue
        external[element.GlobalId] = {
            "globalId": element.GlobalId,
            "name": model.label(element),
            "ifcType": element.is_a(),
            "apertureArea": 0.0,
            "apertures": [],
        }

    for element in bounding:
        if element.is_a() not in op.FENESTRATION:
            continue
        faces_outside, _why = op._faces_outside(model, element)
        if faces_outside is not True:
            continue
        hosts_ = op.hosted_in(model, element.GlobalId)
        area = _aperture_area(model, element)
        if not area:
            continue
        _add_aperture(external, hosts_.value or [], element, area)

    ranked = sorted(external.values(), key=lambda c: (-float(c["apertureArea"]), c["globalId"]))
    return ranked


def _counts_as_external(model: SpatialModel, element: Any) -> bool:
    declared = model.declared_property(element, ("IsExternal",))
    if declared is False:
        return False
    if declared is True:
        return True
    rooms = op.enclosed_by(model, element.GlobalId)
    if not rooms.decidable or not rooms.value:
        return False
    return op._rooms_on_one_side(model, element, rooms.value) is True


def _add_aperture(external: dict[str, dict[str, Any]], hosts: list[Any], element: Any, area: float) -> None:
    for ref in hosts:
        candidate = external.get(ref.global_id)
        if candidate is None:
            continue
        candidate["apertureArea"] = float(candidate["apertureArea"]) + float(area)
        candidate["apertures"].append(element.GlobalId)


def _facade_geometry(model: SpatialModel, facade_id: str, method: str) -> tuple[np.ndarray, Answer[Any] | None, bool]:
    plane = op.facade_plane_of(model, facade_id)
    if not plane.decidable or plane.value is None:
        return (
            np.zeros(2),
            undecidable(
                from_=[facade_id],
                method=method,
                provenance="computed",
                missing=plane.missing
                or MissingFact(
                    what=f"keine Fassadenebene für {facade_id}",
                    remedy="Ohne Bezugsebene ist keine Raumtiefe messbar.",
                ),
            ),
            False,
        )
    normal = np.array(plane.value["normal"], dtype=float)[:2]
    length = float(np.linalg.norm(normal))
    if length < 1e-9:
        return (
            np.zeros(2),
            undecidable(
                from_=[facade_id],
                method=method,
                provenance="computed",
                missing=MissingFact(
                    what=f"die Fassadenebene von {facade_id} steht waagrecht",
                    remedy=(
                        "Eine Raumtiefe wird senkrecht zur Fassade im Grundriss gemessen. Dieses Bauteil hat "
                        "keine senkrechte Fläche (z. B. eine Decke oder ein Flachdach) und kann die "
                        "Bezugsrichtung nicht liefern. bounds() zeigt die Wände des Raums."
                    ),
                    elements=[facade_id],
                ),
            ),
            False,
        )
    return normal / length, None, bool(plane.value["outward"])


def room_depth(
    model: SpatialModel,
    space_global_id: str,
    facade_element_global_id: str | None = None,
) -> Answer[dict[str, Any]]:
    method = f"roomDepth({space_global_id})"
    subject = op._require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        op._wrong_kind(
            subject,
            method,
            "roomDepth",
            "einen Raum (IfcSpace)",
            "für die Ausdehnung eines Bauteils: extent() liefert sie",
        )

    geo, missing = op._geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    bounding = op.bounds(model, space_global_id)
    if not bounding.decidable:
        return bounding  # type: ignore[return-value]
    bounding_elements = [model.file.by_guid(ref.global_id) for ref in (bounding.value or [])]

    candidates = _facade_candidates(model, space_global_id, bounding_elements)
    curtain_wall = [e for e in bounding_elements if e.is_a() in CURTAIN_WALL_TYPES]
    choice = _choose_facade(model, space_global_id, facade_element_global_id, candidates, curtain_wall, method)
    if not isinstance(choice, tuple):
        return choice
    facade_id, chosen, why = choice

    method = f"roomDepth({space_global_id}, facade={facade_id})"
    normal, refusal, outward = _facade_geometry(model, facade_id, method)
    if refusal is not None:
        return refusal  # type: ignore[return-value]

    points = _footprint_points(geo.triangles)
    from_footprint = points is not None
    if points is None:
        points = geo.verts[:, :2]

    along = np.array([-normal[1], normal[0]])
    depth = _extent_along(points, normal)
    width = _extent_along(points, along)

    floor = op.floor_area(model, space_global_id)
    floor_value = float(floor.value) if floor.decidable and floor.value else None
    height = op.clear_height(model, space_global_id)
    height_value = float(height.value) if height.decidable and height.value else None

    value = _depth_value(model, facade_id, normal, why, candidates, depth, width, floor_value, height_value)

    return computed(
        value,
        unit="m",
        tolerance=op.DIMENSION_TOLERANCE,
        from_=[space_global_id, facade_id, *(chosen["apertures"] if chosen else [])],
        method=method,
        caveat=_depth_caveat(
            model,
            chosen=chosen,
            candidates=candidates,
            facade_id=facade_id,
            outward=outward,
            depth=depth,
            width=width,
            floor_value=floor_value,
            height=height,
            height_value=height_value,
            from_footprint=from_footprint,
            curtain_wall=curtain_wall,
            bounding=bounding,
            caller_supplied=facade_element_global_id is not None,
        ),
    )


def _choose_facade(
    model: SpatialModel,
    space_global_id: str,
    facade_element_global_id: str | None,
    candidates: list[dict[str, Any]],
    curtain_wall: list[Any],
    method: str,
) -> tuple[str, dict[str, Any] | None, str] | Answer[Any]:
    if facade_element_global_id is not None:
        facade = op._require(model, facade_element_global_id, method)
        facade_id = facade.GlobalId
        chosen = next((c for c in candidates if c["globalId"] == facade_id), None)
        return facade_id, chosen, "vom Aufrufer vorgegeben"
    chosen = candidates[0] if candidates and float(candidates[0]["apertureArea"]) > 0 else None
    if chosen is None:
        return _no_facade(model, space_global_id, method, candidates, curtain_wall)
    facade_id = str(chosen["globalId"])
    why = (
        f"größte außenliegende Öffnungsfläche der begrenzenden Außenwände "
        f"({float(chosen['apertureArea']):.4f} m² aus {len(chosen['apertures'])} Öffnung(en))"
    )
    return facade_id, chosen, why


def _depth_value(
    model: SpatialModel,
    facade_id: str,
    normal: np.ndarray,
    why: str,
    candidates: list[dict[str, Any]],
    depth: float,
    width: float,
    floor_value: float | None,
    height_value: float | None,
) -> dict[str, Any]:
    facade_element = model.file.by_guid(facade_id)
    bearing = op.azimuth(model, facade_id)

    return {
        "depth": round(depth, 4),
        "width": round(width, 4),
        "clearHeight": None if height_value is None else round(height_value, 4),
        "depthToHeight": None if not height_value else round(depth / height_value, 4),
        "floorArea": None if floor_value is None else round(floor_value, 4),
        "depthTimesWidth": round(depth * width, 4),
        "facade": {
            "globalId": facade_id,
            "name": model.label(facade_element),
            "ifcType": facade_element.is_a(),
            "normal": [round(float(normal[0]), 6), round(float(normal[1]), 6)],
            "azimuth": bearing.value if bearing.decidable else None,
            "why": why,
        },
        "candidates": candidates,
    }


__all__ = [
    "above",
    "below",
    "room_depth",
    "sun_position",
]
