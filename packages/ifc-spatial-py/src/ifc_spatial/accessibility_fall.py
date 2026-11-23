from __future__ import annotations

import math
from typing import Any

from ifc_spatial.accessibility_constants import _VOID_PROBES
from ifc_spatial.accessibility_constants import RAILING_FOOT
from ifc_spatial.accessibility_constants import RAILING_REACH
from ifc_spatial.accessibility_floor import _is_floor_void
from ifc_spatial.accessibility_floor import _surface_below
from ifc_spatial.accessibility_records import _Frame

from .model import SpatialModel
from .operators import CONTACT
from .operators import COORDINATE_TOLERANCE
from .operators import DIMENSION_TOLERANCE


def _fall_through(model: SpatialModel, opening: Any, railings: list[Any], space: Any | None) -> dict[str, Any] | None:
    geo = model.geometry(opening.GlobalId)
    if geo is None or len(geo.triangles) == 0:
        return None
    if not _is_floor_void(model, opening, geo):
        return None

    x_min, y_min, z_min = (float(v) for v in geo.box[0])
    x_max, y_max, z_max = (float(v) for v in geo.box[1])
    rect = (x_min, y_min, x_max, y_max)
    top, inside_space = z_max, None
    if space is not None:
        space_geo = model.geometry(space.GlobalId)
        if space_geo is None:
            return None
        floor = float(space_geo.box[0][2])
        reach = _plan_gap(rect, space_geo.box)
        if reach > CONTACT:
            return _void_away_from(model, opening, space, floor, reach)
        if floor < z_min - DIMENSION_TOLERANCE:
            return _void_overhead(model, opening, space, floor, (z_min, z_max))
        if floor > z_max + DIMENSION_TOLERANCE:
            return None
        top, inside_space = floor, space

    probe_z = (z_min + z_max) / 2.0
    deepest: tuple[float, Any] | None = None
    for fx, fy in _VOID_PROBES:
        found = _surface_below(model, x_min + fx * (x_max - x_min), y_min + fy * (y_max - y_min), probe_z)
        if found is not None and (deepest is None or found[0] < deepest[0]):
            deepest = found
    if deepest is None:
        return None
    level, hit = deepest

    return {
        "globalId": opening.GlobalId,
        "name": model.label(opening),
        "ifcType": opening.is_a(),
        "fall": round(top - level, 4),
        "parapet": None,
        "position": "horizontal",
        "inside": {
            "direction": [0.0, 0.0],
            "space": None if inside_space is None else inside_space.GlobalId,
            "spaceName": None if inside_space is None else model.label(inside_space),
            "level": round(top, 4),
            "via": (
                "Fußboden am Rand der waagrechten Öffnung (Unterkante des Raumkörpers)"
                if inside_space is not None
                else "Oberkante der waagrechten Öffnung (kein Raum in der Anfrage)"
            ),
            "surface": None,
        },
        "outside": {
            "direction": [0.0, 0.0],
            "space": None,
            "spaceName": None,
            "level": round(level, 4),
            "via": f"Strahl senkrecht nach unten durch die Öffnung, tiefster von {len(_VOID_PROBES)} Punkten",
            "surface": {
                "globalId": hit.GlobalId,
                "name": model.label(hit),
                "ifcType": hit.is_a(),
                "top": round(level, 4),
                "gap": None,
            },
        },
        "railings": _railings_at_void(model, (x_min, y_min, x_max, y_max), top, railings),
    }


def _plan_gap(rect: tuple[float, float, float, float], box: Any) -> float:
    gap_x = max(rect[0] - float(box[1][0]), float(box[0][0]) - rect[2], 0.0)
    gap_y = max(rect[1] - float(box[1][1]), float(box[0][1]) - rect[3], 0.0)
    return math.hypot(gap_x, gap_y)


def _void_away_from(model: SpatialModel, opening: Any, space: Any, floor: float, reach: float) -> dict[str, Any]:
    return {
        "globalId": opening.GlobalId,
        "name": model.label(opening),
        "ifcType": opening.is_a(),
        "fall": None,
        "parapet": None,
        "position": "horizontal",
        "inside": {
            "direction": [0.0, 0.0],
            "space": space.GlobalId,
            "spaceName": model.label(space),
            "level": round(floor, 4),
            "via": "Unterkante des Raumkörpers (IfcSpace)",
            "surface": None,
        },
        "outside": {
            "direction": [0.0, 0.0],
            "space": None,
            "spaceName": None,
            "level": None,
            "via": (
                f"waagrechte Öffnung derselben Decke, aber {reach:.3f} m von diesem Raum entfernt (im "
                "Grundriss) — sie liegt nicht an seinem Fußboden und ist hier keine Fallhöhe; sie steht in "
                "dieser Liste, weil die Decke, in der sie sitzt, den Raum begrenzt"
            ),
            "surface": None,
        },
        "railings": [],
    }


def _void_overhead(
    model: SpatialModel, opening: Any, space: Any, floor: float, span: tuple[float, float]
) -> dict[str, Any]:
    return {
        "globalId": opening.GlobalId,
        "name": model.label(opening),
        "ifcType": opening.is_a(),
        "fall": None,
        "parapet": None,
        "position": "horizontal",
        "inside": {
            "direction": [0.0, 0.0],
            "space": space.GlobalId,
            "spaceName": model.label(space),
            "level": round(floor, 4),
            "via": "Unterkante des Raumkörpers (IfcSpace)",
            "surface": None,
        },
        "outside": {
            "direction": [0.0, 0.0],
            "space": None,
            "spaceName": None,
            "level": None,
            "via": (
                f"waagrechte Öffnung in der DECKE dieses Raums (Öffnung von {span[0]:.3f} m bis "
                f"{span[1]:.3f} m, Fußboden dieses Raums bei {floor:.3f} m) — von hier aus führt sie nicht "
                "abwärts; die Fallhöhe ist am darüberliegenden Raum zu messen"
            ),
            "surface": None,
        },
        "railings": [],
    }


def _railings_at_void(
    model: SpatialModel, rect: tuple[float, float, float, float], top: float, railings: list[Any]
) -> list[dict[str, Any]]:
    found = []
    for railing in railings:
        geo = model.geometry(railing.GlobalId)
        if geo is None:
            continue
        base, crest = float(geo.box[0][2]), float(geo.box[1][2])
        if crest <= top + COORDINATE_TOLERANCE or base > top + RAILING_FOOT:
            continue
        if _plan_gap(rect, geo.box) > RAILING_REACH:
            continue
        found.append(
            {
                "globalId": railing.GlobalId,
                "name": model.label(railing),
                "ifcType": railing.is_a(),
                "height": round(crest - top, 4),
                "top": round(crest, 4),
            }
        )
    found.sort(key=lambda r: (-r["height"], r["globalId"]))
    return found


def _railings_at(
    model: SpatialModel, frame: _Frame, sign: float, inside_level: float, railings: list[Any]
) -> list[dict[str, Any]]:
    reference = frame.outer_face(sign) * sign
    found = []
    for railing in railings:
        geo = model.geometry(railing.GlobalId)
        if geo is None:
            continue
        points = geo.verts[:, :2]
        across = points @ frame.lateral
        outward = (points @ frame.normal) * sign
        if float(outward.min()) > reference + RAILING_REACH:
            continue  # entirely beyond reach of this edge
        if float(outward.max()) < reference - COORDINATE_TOLERANCE:
            continue  # entirely on the inside of the wall face
        if float(across.max()) < frame.u_min - 0.5 or float(across.min()) > frame.u_max + 0.5:
            continue
        found.append(
            {
                "globalId": railing.GlobalId,
                "name": model.label(railing),
                "ifcType": railing.is_a(),
                "height": round(float(geo.box[1][2]) - inside_level, 4),
                "top": round(float(geo.box[1][2]), 4),
            }
        )
    found.sort(key=lambda r: (-r["height"], r["globalId"]))
    return found
