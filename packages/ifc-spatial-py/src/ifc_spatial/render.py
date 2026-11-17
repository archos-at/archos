from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .model import AIR_TYPES
from .model import SpatialModel

CUT_ABOVE_STOREY = 1.2

MAX_RASTER_PIXELS = 40_000_000

MAX_RASTER_WIDTH = 8_000

_MIN_RASTER_EDGE = 320

_CAPTION_STRIP = 46

_FURNITURE = {"IfcFurniture", "IfcFurnishingElement", "IfcSystemFurnitureElement"}

_STRUCTURE = (
    "IfcWall",
    "IfcWallStandardCase",
    "IfcColumn",
    "IfcBeam",
    "IfcSlab",
    "IfcRoof",
    "IfcStair",
    "IfcCurtainWall",
    "IfcPlate",
    "IfcMember",
    "IfcDoor",
    "IfcWindow",
)


def _font(size: int) -> Any:
    from PIL import ImageFont

    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _shorten(label: str, limit: int = 34) -> str:
    label = (label or "").strip()
    return label if len(label) <= limit else "…" + label[-(limit - 1) :]


def _fit_raster(
    width_px: int,
    margin_px: int,
    span_x: float,
    span_y: float,
) -> tuple[int, int, int, float]:
    width = max(_MIN_RASTER_EDGE, min(int(width_px), MAX_RASTER_WIDTH))
    margin = max(0, min(int(margin_px), width // 4))

    scale = (width - 2 * margin) / span_x
    height = int(span_y * scale) + 2 * margin + _CAPTION_STRIP

    ceiling = max(_MIN_RASTER_EDGE, MAX_RASTER_PIXELS // width)
    if height > ceiling:
        scale = max(ceiling - 2 * margin - _CAPTION_STRIP, 1) / span_y
        height = int(span_y * scale) + 2 * margin + _CAPTION_STRIP
        width = max(_MIN_RASTER_EDGE, min(width, int(span_x * scale) + 2 * margin))
    return width, height, margin, scale


_INK = (24, 24, 27)
_PAPER = (250, 250, 249)
_ROOM_FILL = (232, 237, 243)
_ROOM_EDGE = (150, 163, 180)
_FURNITURE_INK = (188, 192, 198)
_HIGHLIGHT = (220, 38, 38)
_LABEL = (63, 63, 70)


@dataclass(frozen=True)
class Plan:
    png: bytes
    width: int
    height: int
    storey: str | None
    cut_z: float
    scale_px_per_m: float
    drawn: int
    highlighted: list[str]
    rooms: list[str]
    north_deg: float | None


def _segments_at_z(triangles: np.ndarray, z: float) -> list[tuple[float, float, float, float]]:
    if triangles is None or len(triangles) == 0:
        return []

    out: list[tuple[float, float, float, float]] = []
    heights = triangles[:, :, 2] - z
    above = heights > 1e-9
    below = heights < -1e-9
    crossing = above.any(axis=1) & below.any(axis=1)
    for tri, h in zip(triangles[crossing], heights[crossing]):
        points = []
        for i in range(3):
            j = (i + 1) % 3
            if (h[i] > 0) == (h[j] > 0):
                continue
            denominator = h[i] - h[j]
            if abs(denominator) < 1e-12:
                continue
            t = h[i] / denominator
            point = tri[i] + (tri[j] - tri[i]) * t
            points.append((float(point[0]), float(point[1])))
        if len(points) >= 2:
            out.append((points[0][0], points[0][1], points[1][0], points[1][1]))
    return out


def _footprint_rings(triangles: np.ndarray) -> list[list[tuple[float, float]]]:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return []
    edges = triangles[:, 1] - triangles[:, 0]
    others = triangles[:, 2] - triangles[:, 0]
    normals = np.cross(edges, others)
    lengths = np.linalg.norm(normals, axis=1)
    ok = lengths > 1e-12
    unit_z = np.zeros(len(triangles))
    unit_z[ok] = normals[ok][:, 2] / lengths[ok]

    best: list[list[tuple[float, float]]] = []
    best_area = 0.0
    for sign in (1.0, -1.0):
        facing = triangles[unit_z * sign > 0.01]
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
            merged = shapely.ops.unary_union(polygons)
        except Exception:
            continue
        if merged.area <= best_area:
            continue
        best_area = merged.area
        geoms = merged.geoms if hasattr(merged, "geoms") else [merged]
        best = [[(float(x), float(y)) for x, y in g.exterior.coords] for g in geoms if hasattr(g, "exterior")]
    return best


def _storey_of_interest(model: SpatialModel, storey: str | None) -> Any:
    if not model.storeys:
        return None
    if not storey:
        return model.file.by_guid(model.storeys[0].global_id)
    wanted = storey.strip().lower()
    for entry in model.storeys:
        if (entry.name or "").strip().lower() == wanted:
            return model.file.by_guid(entry.global_id)
    return None


def plan(
    model: SpatialModel,
    *,
    storey: str | None = None,
    highlight: list[str] | None = None,
    only: list[str] | None = None,
    width_px: int = 1400,
    margin_px: int = 48,
    label_rooms: bool = True,
) -> Plan | None:
    from PIL import Image
    from PIL import ImageDraw

    highlighted = {h for h in (highlight or []) if h}
    restricted = {o for o in (only or []) if o}

    target = _storey_of_interest(model, storey)
    if target is None:
        return None
    storey_name = getattr(target, "Name", None)
    elevation = next(
        (s.elevation for s in model.storeys if s.global_id == target.GlobalId),
        0.0,
    )
    cut_z = float(elevation or 0.0) + CUT_ABOVE_STOREY

    structure: list[tuple[str, list[tuple[float, float, float, float]]]] = []
    furniture: list[tuple[float, float, float, float]] = []
    rooms: list[tuple[str, list[list[tuple[float, float]]]]] = []
    room_names: list[str] = []

    for element in model.file.by_type("IfcProduct"):
        global_id = getattr(element, "GlobalId", None)
        if not global_id:
            continue
        if restricted and global_id not in restricted:
            continue
        ifc_type = element.is_a()
        own_storey = model.storey_of(element)
        if own_storey is not None and own_storey.GlobalId != target.GlobalId:
            continue

        if ifc_type in ("IfcSpace", "IfcSpatialZone"):
            geo = model.geometry(global_id)
            if geo is None:
                continue
            rings = _footprint_rings(geo.triangles)
            if rings:
                rooms.append((global_id, rings))
                room_names.append(model.label(element) or global_id)
            continue

        if ifc_type in AIR_TYPES:
            continue
        drawable = ifc_type in _FURNITURE or ifc_type in _STRUCTURE or global_id in highlighted
        if not drawable:
            continue
        geo = model.geometry(global_id)
        if geo is None:
            continue
        segments = _segments_at_z(geo.triangles, cut_z)
        if not segments:
            continue
        if ifc_type in _FURNITURE and global_id not in highlighted:
            furniture.extend(segments)
        else:
            structure.append((global_id, segments))

    if not structure and not rooms:
        return None

    xs: list[float] = []
    ys: list[float] = []
    for _, segments in structure:
        for x1, y1, x2, y2 in segments:
            xs += [x1, x2]
            ys += [y1, y2]
    for _, rings in rooms:
        for ring in rings:
            xs += [p[0] for p in ring]
            ys += [p[1] for p in ring]
    if not xs:
        return None

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)
    width_px, height_px, margin_px, scale = _fit_raster(width_px, margin_px, span_x, span_y)

    def to_px(x: float, y: float) -> tuple[float, float]:
        return (margin_px + (x - min_x) * scale, margin_px + (max_y - y) * scale)

    image = Image.new("RGB", (width_px, height_px), _PAPER)
    canvas = ImageDraw.Draw(image, "RGBA")

    for _, rings in rooms:
        for ring in rings:
            if len(ring) >= 3:
                canvas.polygon([to_px(x, y) for x, y in ring], fill=_ROOM_FILL, outline=_ROOM_EDGE)

    for x1, y1, x2, y2 in furniture:
        canvas.line([to_px(x1, y1), to_px(x2, y2)], fill=_FURNITURE_INK, width=1)

    for global_id, segments in structure:
        marked = global_id in highlighted
        colour = _HIGHLIGHT if marked else _INK
        thickness = 4 if marked else 2
        for x1, y1, x2, y2 in segments:
            canvas.line([to_px(x1, y1), to_px(x2, y2)], fill=colour, width=thickness)

    room_font = _font(17)
    mark_font = _font(16)

    if label_rooms:
        for (global_id, rings), name in zip(rooms, room_names):
            ring = max(rings, key=len)
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            canvas.text(to_px(cx, cy), name, fill=_LABEL, anchor="mm", font=room_font)

    for global_id in highlighted:
        try:
            element = model.file.by_guid(global_id)
        except RuntimeError, KeyError:
            continue
        geo = model.geometry(global_id)
        if geo is None or geo.triangles is None or len(geo.triangles) == 0:
            continue
        centre = geo.triangles.reshape(-1, 3).mean(axis=0)
        px, py = to_px(float(centre[0]), float(centre[1]))
        canvas.ellipse([px - 7, py - 7, px + 7, py + 7], outline=_HIGHLIGHT, width=3)

        text = _shorten(model.label(element) or global_id)
        text_width = canvas.textlength(text, font=mark_font)
        label_y = py + 20 if py < height_px / 2 else py - 20
        label_x = min(max(px, margin_px + text_width / 2), width_px - margin_px - text_width / 2)
        canvas.text((label_x, label_y), text, fill=_HIGHLIGHT, anchor="mm", font=mark_font)

    _draw_scale_bar(canvas, margin_px, height_px - 30, scale, _font(15))
    north = _true_north_degrees(model)
    if north is not None:
        _draw_north_arrow(canvas, width_px - margin_px - 40, margin_px + 40, north, _font(16))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return Plan(
        png=buffer.getvalue(),
        width=width_px,
        height=height_px,
        storey=storey_name,
        cut_z=cut_z,
        scale_px_per_m=scale,
        drawn=len(structure),
        highlighted=sorted(highlighted),
        rooms=room_names,
        north_deg=north,
    )


def _draw_scale_bar(canvas: Any, x: int, y: int, scale: float, font: Any) -> None:
    for metres in (10, 5, 2, 1):
        if metres * scale <= 220:
            break
    length = metres * scale
    canvas.line([(x, y), (x + length, y)], fill=_INK, width=3)
    for tick in (0.0, length):
        canvas.line([(x + tick, y - 6), (x + tick, y + 6)], fill=_INK, width=3)
    canvas.text((x + length + 8, y), f"{metres} m", fill=_INK, anchor="lm", font=font)


def _true_north_degrees(model: SpatialModel) -> float | None:
    for context in model.file.by_type("IfcGeometricRepresentationContext") or []:
        direction = getattr(context, "TrueNorth", None)
        ratios = getattr(direction, "DirectionRatios", None) if direction else None
        if ratios and len(ratios) >= 2:
            return math.degrees(math.atan2(float(ratios[0]), float(ratios[1])))
    return None


def _draw_north_arrow(canvas: Any, x: int, y: int, north_deg: float, font: Any) -> None:
    angle = math.radians(north_deg)
    dx, dy = math.sin(angle), -math.cos(angle)
    canvas.line([(x - dx * 18, y - dy * 18), (x + dx * 18, y + dy * 18)], fill=_INK, width=3)
    canvas.text((x + dx * 26, y + dy * 26), "N", fill=_INK, anchor="mm", font=font)


__all__ = ["CUT_ABOVE_STOREY", "Plan", "plan"]
