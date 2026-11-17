from __future__ import annotations

import math
import time
from typing import Any

import numpy as np

from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .geometry import box_gap
from .geometry import dominant_vertical_plane
from .geometry import triangle_normals_areas
from .model import AIR_TYPES
from .model import ElementGeometry
from .model import SpatialModel
from .operators import DIMENSION_TOLERANCE
from .operators import FENESTRATION
from .operators import _geometry_or_answer
from .operators import _require
from .operators import _wrong_kind


CLEARANCE_MAX_TRIANGLE_PAIRS = 1_600_000_000

CLEARANCE_BUDGET_SECONDS = 20.0

AXIS_ALIGNED_DEGREES = 0.5

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




def clear_width(model: SpatialModel, a_global_id: str, b_global_id: str) -> Answer[dict[str, Any]]:
    method = f"clearWidth({a_global_id}, {b_global_id})"
    first = _require(model, a_global_id, method)
    second = _require(model, b_global_id, method)

    if a_global_id == b_global_id:
        return undecidable(
            from_=[a_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="clearWidth() hat zweimal dasselbe Bauteil bekommen",
                remedy=(
                    "Ein lichtes Maß braucht zwei verschiedene Bauteile — die beiden Laibungen einer "
                    "Öffnung, zwei Wände eines Gangs, Handlauf und Wand. Für das lichte Maß EINER Öffnung "
                    "ist clearOpeningWidth() der richtige Aufruf, für die Höhe eines Raums clearHeight()."
                ),
                elements=[a_global_id],
            ),
        )

    geo_a, missing = _geometry_or_answer(model, first, method, [a_global_id, b_global_id])
    if geo_a is None:
        return missing  # type: ignore[return-value]
    geo_b, missing = _geometry_or_answer(model, second, method, [a_global_id, b_global_id])
    if geo_b is None:
        return missing  # type: ignore[return-value]

    tris_a = _usable_triangles(geo_a)
    tris_b = _usable_triangles(geo_b)
    if len(tris_a) == 0 or len(tris_b) == 0:
        empty = first if len(tris_a) == 0 else second
        return undecidable(
            from_=[a_global_id, b_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"{empty.is_a()} „{model.label(empty) or empty.GlobalId}“ hat nur entartete Dreiecke",
                remedy=(
                    "Der Körper dieses Bauteils besteht aus Dreiecken ohne Fläche — im Export ist die Form "
                    "zusammengefallen (ein Profil mit Nullfläche, eine Extrusion der Länge 0). Das Bauteil im "
                    "CAD neu aufziehen und erneut exportieren."
                ),
                elements=[empty.GlobalId],
            ),
        )

    pairs = len(tris_a) * len(tris_b)
    if pairs > CLEARANCE_MAX_TRIANGLE_PAIRS:
        return undecidable(
            from_=[a_global_id, b_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=(f"zu fein vernetzt für eine exakte Flächenmessung: {len(tris_a)} × {len(tris_b)} Dreiecke"),
                remedy=(
                    "Das lichte Maß wird zwischen den Dreiecken beider Körper gemessen; bei dieser "
                    "Netzfeinheit dauert das zu lange. Abhilfe: die Frage an den tragenden Bauteilen stellen "
                    "statt an möblierten oder detaillierten Modellen (Wand gegen Wand statt Türblatt gegen "
                    "Möbel), oder das Modell mit gröberer Tessellierung exportieren."
                ),
                elements=[a_global_id, b_global_id],
            ),
        )

    started = time.perf_counter()
    value, point_a, point_b, tested, aborted = _soup_distance(tris_a, tris_b, CLEARANCE_BUDGET_SECONDS)
    seconds = time.perf_counter() - started

    if aborted:
        return undecidable(
            from_=[a_global_id, b_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=(
                    f"Messung nach {seconds:.0f} s abgebrochen ({len(tris_a)} × {len(tris_b)} Dreiecke, "
                    f"{tested} exakte Paarvergleiche)"
                ),
                remedy=(
                    "Diese beiden Körper liegen über eine große, fein vernetzte Fläche fast parallel "
                    "zueinander — dabei ist kein Dreieckspaar ausschließbar. Abhilfe: einen kleineren "
                    "Ausschnitt vergleichen (etwa die Laibung statt der ganzen Wand) oder das Modell mit "
                    "gröberer Tessellierung exportieren. Ein Zwischenergebnis wird bewusst nicht gemeldet: "
                    "eine abgebrochene Suche liefert eine OBERGRENZE, und eine Obergrenze als lichtes Maß zu "
                    "lesen ist genau der Fehler, den diese Messung verhindern soll."
                ),
                elements=[a_global_id, b_global_id],
            ),
        )

    gap = box_gap(geo_a.box, geo_b.box)
    box_distance = float(np.linalg.norm(np.maximum(gap, 0.0)))

    caveat = (
        "Gemessen zwischen den Oberflächen der beiden tessellierten Körper, nicht zwischen ihren Hüllboxen "
        "und nicht zwischen ihren Schwerpunkten. Das ist ein lichtes Maß im Rohbau: Putz, Bekleidungen, "
        "Beschläge und Türblätter im geöffneten Zustand sind nur enthalten, soweit sie im Modell als Körper "
        "vorhanden sind."
    )
    if value <= 0.0:
        caveat = (
            "Die beiden Körper berühren oder durchdringen einander — das lichte Maß ist 0 m. Das ist ein "
            "Messergebnis an den Flächen, keine Hüllbox-Aussage: hier schneiden sich tatsächlich Dreiecke "
            "beider Körper. Bei einem Fenster in seiner Laibung ist das normal, bei zwei tragenden Bauteilen "
            "ein Befund."
        )
    air = [e for e in (first, second) if e.is_a() in AIR_TYPES]
    if air:
        caveat += (
            " Mindestens eines der beiden Bauteile ist kein fester Körper, sondern Luft bzw. eine Aussparung ("
            + ", ".join(sorted({e.is_a() for e in air}))
            + "). Der Abstand wird dann zu einer gedachten Fläche gemessen, nicht zu einer gebauten."
        )
    if box_distance < value - DIMENSION_TOLERANCE:
        caveat += (
            f" Zum Vergleich: distance('min') hätte {box_distance:.3f} m gemeldet — der Hüllbox-Abstand "
            "unterschätzt das lichte Maß hier, wie immer bei schräg stehenden oder nicht quaderförmigen "
            "Bauteilen."
        )

    return computed(
        {
            "distance": value,
            "pointOnA": [float(v) for v in point_a],
            "pointOnB": [float(v) for v in point_b],
            "boxGap": box_distance,
            "trianglesA": int(len(tris_a)),
            "trianglesB": int(len(tris_b)),
            "exactPairsTested": int(tested),
            "seconds": round(seconds, 4),
        },
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[a_global_id, b_global_id],
        method=method,
        caveat=caveat,
    )


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


def clear_opening_width(model: SpatialModel, opening_or_filler_global_id: str) -> Answer[dict[str, Any]]:
    method = f"clearOpeningWidth({opening_or_filler_global_id})"
    subject = _require(model, opening_or_filler_global_id, method)
    kind = model.kind_of(subject)

    if kind != "opening" and subject.is_a() not in FENESTRATION:
        _wrong_kind(
            subject,
            method,
            "clearOpeningWidth",
            "eine Öffnung, ein Fenster oder eine Tür",
            (
                "für eine Wand: hosts() liefert ihre Öffnungen, danach clearOpeningWidth() je Öffnung; "
                "für den lichten Abstand zwischen zwei Bauteilen: clearWidth()"
            ),
        )

    if kind == "opening":
        openings = [subject]
    else:
        openings = [rel.RelatingOpeningElement for rel in (getattr(subject, "FillsVoids", []) or [])]

    projection = None
    measured_on = None
    via = "IfcOpeningElement"
    for opening in openings:
        projection = _aperture_polygon(model, opening)
        if projection is not None:
            measured_on = opening
            break
    if projection is None:
        projection = _aperture_polygon(model, subject)
        measured_on = subject
        via = "Bauteilkörper (Rahmen und Bekleidung enthalten)"

    if projection is None or measured_on is None:
        name = model.label(subject) or subject.GlobalId
        return undecidable(
            from_=[opening_or_filler_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"keine in einer senkrechten Ebene liegende Öffnungsfläche an {subject.is_a()} „{name}“",
                remedy=(
                    "Das lichte Maß wird auf der Öffnungsebene gemessen. Diese Öffnung hat entweder keinen "
                    "Körper im Export, oder sie liegt waagrecht (ein Dachflächenfenster in einem Flachdach) "
                    "und hat damit keine senkrechte Ebene. Abhilfe: den Export mit Öffnungen und Füllungen "
                    "sowie mit Körpergeometrie wiederholen. Für ein waagrechtes Fenster ist die lichte "
                    "Öffnung im Grundriss zu messen — dafür ist extent() bzw. orientedExtent() zuständig."
                ),
                elements=[subject.GlobalId],
            ),
        )

    polygon, normal = projection
    min_x, min_y, max_x, max_y = polygon.bounds
    width = float(max_x - min_x)
    height = float(max_y - min_y)
    area = float(polygon.area)
    filled = area / (width * height) if width > 0 and height > 0 else 0.0

    caveat = (
        "Gemessen ist die ROHBAULICHTE — die lichte Öffnung im Rohbau, projiziert auf die Öffnungsebene. "
        "Die lichte DURCHGANGSBREITE einer Tür wird zwischen den fertigen Zargenfalzen gemessen und ist bei "
        "einer üblichen Tür 15–25 % kleiner. Welches der beiden Maße die Bestimmung meint, entscheidet die "
        "Bestimmung; hier wird nur gemessen."
    )
    if via != "IfcOpeningElement":
        caveat += (
            " Für dieses Bauteil ist keine Öffnung mit Geometrie hinterlegt (IfcRelFillsElement → "
            "IfcRelVoidsElement fehlt oder trägt keinen Körper), deshalb wurde der BAUTEILKÖRPER gemessen. "
            "Dieser schließt Rahmen und Bekleidung ein, die beidseitig auf der Wand aufliegen: das Maß ist "
            "damit eine OBERGRENZE und um einige Zentimeter zu groß (in dieser Datei 50–70 mm). Als "
            "Nachweis einer Mindestbreite ist es nicht verwendbar."
        )
    if filled < 0.98:
        caveat += (
            f" Die Öffnung ist nicht rechteckig ({filled * 100:.0f} % der Umschreibenden sind Öffnungsfläche): "
            "über einen Teil der Höhe ist sie schmäler als die angegebene Breite. Die Breite ist das größte "
            "Maß, nicht das durchgehend lichte."
        )

    return computed(
        {
            "width": width,
            "height": height,
            "area": area,
            "rectangularity": round(filled, 4),
            "measuredOn": measured_on.GlobalId,
            "via": via,
            "planeNormal": [float(v) for v in normal],
        },
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[opening_or_filler_global_id, measured_on.GlobalId],
        method=method,
        caveat=caveat,
    )


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


def oriented_extent(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"orientedExtent({global_id})"
    subject = _require(model, global_id, method)
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    rectangle = _minimum_area_rectangle(geo.verts[:, :2])
    if rectangle is None:
        name = model.label(subject) or global_id
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"kein Grundriss an {subject.is_a()} „{name}“ — alle Punkte liegen auf einer Geraden",
                remedy=(
                    "Der umschließende Rechteckkörper wird über den Grundriss des Bauteils gebildet. Dieses "
                    "Bauteil hat keinen: sein Körper ist eine senkrechte Fläche ohne Dicke oder eine Linie "
                    "(eine Achse, eine Annotation). Für ein flächiges Bauteil den Export mit echter "
                    "Körpergeometrie wiederholen; für eine senkrechte Öffnungsfläche ist "
                    "clearOpeningWidth() das passende Maß."
                ),
                elements=[global_id],
            ),
        )

    length, width, axis = rectangle
    low, high = geo.box
    height = float(high[2] - low[2])

    theta = model.true_north if model.true_north is not None else 0.0
    north = np.array([math.sin(theta), math.cos(theta)])
    east = np.array([north[1], -north[0]])
    bearing = math.degrees(math.atan2(float(axis @ east), float(axis @ north)))
    bearing = math.fmod(math.fmod(bearing, 180.0) + 180.0, 180.0)

    from_model_y = math.degrees(math.atan2(float(axis[0]), float(axis[1])))
    quarter = math.fmod(math.fmod(from_model_y, 90.0) + 90.0, 90.0)
    deviation = min(quarter, 90.0 - quarter)
    aligned = deviation <= AXIS_ALIGNED_DEGREES

    box_width = float(high[0] - low[0])
    box_depth = float(high[1] - low[1])
    box_area = box_width * box_depth
    oriented_area = length * width

    if aligned:
        caveat = (
            "Dieses Bauteil steht achsparallel zum Modell (Abweichung "
            f"{deviation:.2f}°): Länge und Breite stimmen hier mit der achsparallelen Hüllbox überein, "
            "extent() liefert dieselben Zahlen. Gemessen ist die kleinste umschreibende Rechteckfläche im "
            "Grundriss, nicht das Bauteil selbst — bei einem L-förmigen oder gekrümmten Bauteil ist sie "
            "größer als jede seiner Seiten."
        )
    else:
        caveat = (
            f"Dieses Bauteil steht um {deviation:.1f}° schräg zu den Modellachsen. Länge und Breite sind am "
            "gedrehten Rechteck gemessen und beschreiben das Bauteil; die achsparallele Hüllbox aus extent() "
            f"meldet stattdessen {box_width:.3f} × {box_depth:.3f} m, also eine um "
            f"{(box_area / oriented_area - 1) * 100:.0f} % zu große Grundfläche. Die Höhe ist in beiden "
            "Fällen dieselbe: gedreht wird nur im Grundriss."
        )
    if model.true_north is None:
        caveat += (
            " Die Datei deklariert keine Nordrichtung (IfcGeometricRepresentationContext.TrueNorth), deshalb "
            "ist „rotation“ auf die Modellachse +Y bezogen und KEINE Himmelsrichtung."
        )

    return computed(
        {
            "length": length,
            "width": width,
            "height": height,
            "rotation": bearing,
            "deviation": deviation,
            "axisAligned": aligned,
            "longAxis": [float(axis[0]), float(axis[1])],
            "footprintArea": oriented_area,
            "axisAlignedFootprintArea": box_area,
            "northKnown": model.true_north is not None,
        },
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[global_id],
        method=method,
        caveat=caveat,
    )


__all__ = [
    "AXIS_ALIGNED_DEGREES",
    "CLEARANCE_BUDGET_SECONDS",
    "CLEARANCE_MAX_TRIANGLE_PAIRS",
    "clear_opening_width",
    "clear_width",
    "oriented_extent",
]
