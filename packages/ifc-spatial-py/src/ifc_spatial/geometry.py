from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

PARALLEL_DOT = 0.985

HORIZONTAL_DOT = 0.9
FACE_AREA_FRACTION = 0.05
MIN_FACE_AREA = 0.01
FACE_MERGE = 0.01
VERTICAL_TOLERANCE = 0.05


@dataclass(frozen=True)
class Plane:
    normal: np.ndarray
    point: np.ndarray
    support: float


def triangle_normals_areas(triangles: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    doubled = np.linalg.norm(cross, axis=1)
    ok = doubled > 1e-12
    normals = np.zeros_like(cross)
    normals[ok] = cross[ok] / doubled[ok, None]
    return normals, doubled / 2.0


def dominant_plane(triangles: np.ndarray) -> np.ndarray | None:
    normals, areas = triangle_normals_areas(triangles)
    usable = np.linalg.norm(normals, axis=1) > 0
    if not usable.any():
        return None
    normals = normals[usable]
    areas = areas[usable]

    sign = np.zeros(len(normals))
    for axis in (2, 0, 1):
        undecided = sign == 0
        sign = np.where(undecided & (np.abs(normals[:, axis]) > 1e-9), np.sign(normals[:, axis]), sign)
    sign[sign == 0] = 1.0
    folded = normals * sign[:, None]
    keys = np.round(folded / 0.05).astype(np.int64)

    best_area = -1.0
    best: np.ndarray | None = None
    for key in np.unique(keys, axis=0):
        member = (keys == key).all(axis=1)
        area = float(areas[member].sum())
        if area > best_area:
            best_area = area
            mean = (folded[member] * areas[member, None]).sum(axis=0)
            norm = np.linalg.norm(mean)
            best = mean / norm if norm > 1e-12 else folded[member][0]
    return best


def dominant_vertical_plane(triangles: np.ndarray) -> np.ndarray | None:
    normals, areas = triangle_normals_areas(triangles)
    vertical = np.abs(normals[:, 2]) < VERTICAL_TOLERANCE
    if not vertical.any():
        return None
    normals = normals[vertical]
    areas = areas[vertical]

    flip = (normals[:, 0] < 0) | ((np.abs(normals[:, 0]) < 1e-9) & (normals[:, 1] < 0))
    folded = np.where(flip[:, None], -normals, normals)
    keys = np.round(folded[:, :2] / 0.05).astype(np.int64)

    best_area = -1.0
    best: np.ndarray | None = None
    for key in np.unique(keys, axis=0):
        member = (keys == key).all(axis=1)
        area = float(areas[member].sum())
        if area > best_area:
            best_area = area
            mean = (folded[member] * areas[member, None]).sum(axis=0)
            mean[2] = 0.0
            norm = np.linalg.norm(mean)
            best = mean / norm if norm > 1e-12 else folded[member][0]
    return best


def outermost_parallel_face(triangles: np.ndarray, normal: np.ndarray) -> Plane | None:
    normals, areas = triangle_normals_areas(triangles)
    parallel = np.abs(normals @ normal) >= PARALLEL_DOT
    if not parallel.any():
        return None
    tris = triangles[parallel]
    areas = areas[parallel]
    offsets = tris[:, 0] @ normal
    centroids = tris.mean(axis=1)

    bins: list[dict[str, float | np.ndarray]] = []
    for offset, area, centroid in zip(offsets, areas, centroids):
        placed = False
        for b in bins:
            if abs(float(b["offset"]) - float(offset)) <= FACE_MERGE:
                total = float(b["area"]) + float(area)
                b["offset"] = (float(b["offset"]) * float(b["area"]) + float(offset) * float(area)) / total
                b["sum"] = b["sum"] + centroid * float(area)  # type: ignore[operator]
                b["area"] = total
                placed = True
                break
        if not placed:
            bins.append({"offset": float(offset), "area": float(area), "sum": centroid * float(area)})

    largest = max(float(b["area"]) for b in bins)
    floor = max(largest * FACE_AREA_FRACTION, MIN_FACE_AREA)
    usable = [b for b in bins if float(b["area"]) >= floor]
    if not usable:
        return None
    winner = max(usable, key=lambda b: float(b["offset"]))
    return Plane(
        normal=normal,
        point=np.asarray(winner["sum"]) / float(winner["area"]),
        support=float(winner["area"]),
    )


def signed_distance(points: np.ndarray, plane_normal: np.ndarray, plane_point: np.ndarray) -> np.ndarray:
    return (np.atleast_2d(points) - plane_point) @ plane_normal


def clip_polygon(polygon: Sequence[np.ndarray], normal: np.ndarray, point: np.ndarray) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    n = len(polygon)
    if n == 0:
        return out
    for i in range(n):
        current = polygon[i]
        previous = polygon[i - 1]
        d_current = float((current - point) @ normal)
        d_previous = float((previous - point) @ normal)
        if d_current >= 0:
            if d_previous < 0:
                t = d_previous / (d_previous - d_current)
                out.append(previous + (current - previous) * t)
            out.append(current)
        elif d_previous >= 0:
            t = d_previous / (d_previous - d_current)
            out.append(previous + (current - previous) * t)
    return out


def box_gap(a: tuple[np.ndarray, np.ndarray], b: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    return np.maximum(a[0] - b[1], b[0] - a[1])


def boxes_overlap(a: tuple[np.ndarray, np.ndarray], b: tuple[np.ndarray, np.ndarray]) -> bool:
    return bool((box_gap(a, b) < 0).all())


def box_corners(box: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    low, high = box
    return np.array(
        [
            [low[0], low[1], low[2]],
            [high[0], low[1], low[2]],
            [low[0], high[1], low[2]],
            [high[0], high[1], low[2]],
            [low[0], low[1], high[2]],
            [high[0], low[1], high[2]],
            [low[0], high[1], high[2]],
            [high[0], high[1], high[2]],
        ]
    )


def plan_footprint(triangles: np.ndarray) -> Any | None:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    if triangles.size == 0:
        return None
    normals, areas = triangle_normals_areas(triangles)
    usable = (np.linalg.norm(normals, axis=1) > 0) & (normals[:, 2] < -HORIZONTAL_DOT) & (areas > 1e-9)
    if not usable.any():
        usable = (np.linalg.norm(normals, axis=1) > 0) & (areas > 1e-9)
        if not usable.any():
            return None

    polygons = []
    for tri in triangles[usable]:
        polygon = Polygon(tri[:, :2])
        if polygon.is_valid and polygon.area > 1e-9:
            polygons.append(polygon)
    if not polygons:
        return None
    merged = unary_union(polygons)
    return merged if not merged.is_empty else None


__all__ = [
    "Plane",
    "box_corners",
    "box_gap",
    "boxes_overlap",
    "clip_polygon",
    "dominant_plane",
    "dominant_vertical_plane",
    "outermost_parallel_face",
    "plan_footprint",
    "signed_distance",
    "triangle_normals_areas",
]
