from __future__ import annotations

import time

import numpy as np

from .geometry import triangle_normals_areas
from .model import ElementGeometry

_MIN_TRIANGLE_AREA = 1e-12


def _closest_on_triangles(points: np.ndarray, tris: np.ndarray) -> np.ndarray:
    a, b, c = tris[..., 0, :], tris[..., 1, :], tris[..., 2, :]
    ab, ac = b - a, c - a
    d1 = ((points - a) * ab).sum(-1)
    d2 = ((points - a) * ac).sum(-1)
    d3 = ((points - b) * ab).sum(-1)
    d4 = ((points - b) * ac).sum(-1)
    d5 = ((points - c) * ab).sum(-1)
    d6 = ((points - c) * ac).sum(-1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2

    def _ratio(numerator: np.ndarray, denominator: np.ndarray) -> np.ndarray:
        safe = np.where(np.abs(denominator) < 1e-30, 1.0, denominator)
        return np.clip(numerator / safe, 0.0, 1.0)[..., None]

    out = a + ab * _ratio(vb, va + vb + vc) + ac * _ratio(vc, va + vb + vc)
    edge_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    out = np.where(edge_bc[..., None], b + (c - b) * _ratio(d4 - d3, (d4 - d3) + (d5 - d6)), out)
    edge_ca = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    out = np.where(edge_ca[..., None], a + ac * _ratio(d2, d2 - d6), out)
    out = np.where(((d6 >= 0) & (d5 <= d6))[..., None], c, out)
    edge_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    out = np.where(edge_ab[..., None], a + ab * _ratio(d1, d1 - d3), out)
    out = np.where(((d3 >= 0) & (d4 <= d3))[..., None], b, out)
    return np.where(((d1 <= 0) & (d2 <= 0))[..., None], a, out)


def _closest_between_segments(
    p1: np.ndarray, q1: np.ndarray, p2: np.ndarray, q2: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a = (d1 * d1).sum(-1)
    e = (d2 * d2).sum(-1)
    f = (d2 * r).sum(-1)
    c = (d1 * r).sum(-1)
    b = (d1 * d2).sum(-1)
    a_safe = np.where(a < 1e-30, 1.0, a)
    e_safe = np.where(e < 1e-30, 1.0, e)
    denominator = a * e - b * b
    den_safe = np.where(np.abs(denominator) < 1e-30, 1.0, denominator)

    s = np.where(np.abs(denominator) < 1e-30, 0.0, np.clip((b * f - c * e) / den_safe, 0.0, 1.0))
    t = (b * s + f) / e_safe
    s = np.where(t < 0.0, np.clip(-c / a_safe, 0.0, 1.0), s)
    s = np.where(t > 1.0, np.clip((b - c) / a_safe, 0.0, 1.0), s)
    t = np.clip(t, 0.0, 1.0)
    degenerate = a < 1e-30
    s = np.where(degenerate, 0.0, s)
    t = np.where(degenerate, np.clip(f / e_safe, 0.0, 1.0), t)
    return p1 + d1 * s[..., None], p2 + d2 * t[..., None]


def _segments_hit_triangles(p: np.ndarray, q: np.ndarray, tris: np.ndarray) -> np.ndarray:
    edge1 = tris[..., 1, :] - tris[..., 0, :]
    edge2 = tris[..., 2, :] - tris[..., 0, :]
    direction = q - p
    h = np.cross(direction, edge2)
    determinant = (edge1 * h).sum(-1)
    parallel = np.abs(determinant) < 1e-14
    inverse = 1.0 / np.where(parallel, 1.0, determinant)
    s = p - tris[..., 0, :]
    u = inverse * (s * h).sum(-1)
    qv = np.cross(s, edge1)
    v = inverse * (direction * qv).sum(-1)
    t = inverse * (edge2 * qv).sum(-1)
    return ~parallel & (u >= 0.0) & (v >= 0.0) & (u + v <= 1.0) & (t >= 0.0) & (t <= 1.0)


_EDGE_A = np.repeat([0, 1, 2], 3)
_EDGE_B = np.tile([0, 1, 2], 3)


def _triangle_distances(tri: np.ndarray, tris: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    count = len(tris)
    rows = np.arange(count)

    p1 = np.broadcast_to(tri[_EDGE_A][:, None, :], (9, count, 3)).reshape(-1, 3)
    q1 = np.broadcast_to(tri[(_EDGE_A + 1) % 3][:, None, :], (9, count, 3)).reshape(-1, 3)
    p2 = tris[:, _EDGE_B, :].transpose(1, 0, 2).reshape(-1, 3)
    q2 = tris[:, (_EDGE_B + 1) % 3, :].transpose(1, 0, 2).reshape(-1, 3)
    edge_a, edge_b = _closest_between_segments(p1, q1, p2, q2)

    vertices_a = np.broadcast_to(tri[:, None, :], (3, count, 3)).reshape(-1, 3)
    repeated = np.broadcast_to(tris, (3, count, 3, 3)).reshape(-1, 3, 3)
    near_b = _closest_on_triangles(vertices_a, repeated)
    vertices_b = tris.transpose(1, 0, 2).reshape(-1, 3)
    fixed = np.broadcast_to(tri, (3 * count, 3, 3))
    near_a = _closest_on_triangles(vertices_b, fixed)

    on_a = np.concatenate([edge_a, vertices_a, near_a])
    on_b = np.concatenate([edge_b, near_b, vertices_b])
    distances = np.linalg.norm(on_a - on_b, axis=1).reshape(15, count)
    which = np.argmin(distances, axis=0)
    best = distances[which, rows]
    point_a = on_a.reshape(15, count, 3)[which, rows]
    point_b = on_b.reshape(15, count, 3)[which, rows]

    if (best > 0.0).any():
        ends_a = np.broadcast_to(np.roll(tri, -1, axis=0)[:, None, :], (3, count, 3)).reshape(-1, 3)
        ends_b = np.roll(tris, -1, axis=1).transpose(1, 0, 2).reshape(-1, 3)
        hit = _segments_hit_triangles(vertices_a, ends_a, repeated).reshape(3, count).any(axis=0)
        hit |= _segments_hit_triangles(vertices_b, ends_b, fixed).reshape(3, count).any(axis=0)
        if hit.any():
            best = np.where(hit, 0.0, best)
            middle = (point_a + point_b) / 2.0
            point_a = np.where(hit[:, None], middle, point_a)
            point_b = np.where(hit[:, None], middle, point_b)
    return best, point_a, point_b


def _usable_triangles(geo: ElementGeometry) -> np.ndarray:
    tris = geo.triangles
    _, areas = triangle_normals_areas(tris)
    return tris[areas > _MIN_TRIANGLE_AREA]


def _soup_distance(
    tris_a: np.ndarray, tris_b: np.ndarray, budget: float
) -> tuple[float, np.ndarray, np.ndarray, int, bool]:
    lo_a, hi_a = tris_a.min(axis=1), tris_a.max(axis=1)
    lo_b, hi_b = tris_b.min(axis=1), tris_b.max(axis=1)
    whole_b = (lo_b.min(axis=0), hi_b.max(axis=0))

    outer = np.maximum(lo_a - whole_b[1], whole_b[0] - hi_a)
    outer_bound = np.linalg.norm(np.maximum(outer, 0.0), axis=1)
    order = np.argsort(outer_bound)

    best = float("inf")
    point_a = np.zeros(3)
    point_b = np.zeros(3)
    tested = 0
    started = time.perf_counter()

    for index in order:
        if outer_bound[index] >= best:
            break
        if time.perf_counter() - started > budget:
            return best, point_a, point_b, tested, True
        gap = np.maximum(lo_a[index] - hi_b, lo_b - hi_a[index])
        bound = np.linalg.norm(np.maximum(gap, 0.0), axis=1)
        candidates = np.flatnonzero(bound < best)
        if candidates.size == 0:
            continue
        distances, pa, pb = _triangle_distances(tris_a[index], tris_b[candidates])
        tested += candidates.size
        winner = int(np.argmin(distances))
        if float(distances[winner]) < best:
            best = float(distances[winner])
            point_a = pa[winner]
            point_b = pb[winner]
        if best <= 0.0:
            break
    return best, point_a, point_b, tested, False
