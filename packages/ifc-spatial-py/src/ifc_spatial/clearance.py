from __future__ import annotations

import math
import time
from typing import Any

import numpy as np

from .clearance_refusals import _aborted
from .clearance_refusals import _degenerate
from .clearance_refusals import _no_aperture
from .clearance_refusals import _no_footprint
from .clearance_refusals import _same_element
from .clearance_refusals import _too_fine
from .clearance_shapes import _aperture_polygon
from .clearance_shapes import _minimum_area_rectangle
from .clearance_triangles import _soup_distance
from .clearance_triangles import _usable_triangles
from .envelope import Answer
from .envelope import computed
from .geometry import box_gap
from .model import AIR_TYPES
from .model import SpatialModel
from .operators import DIMENSION_TOLERANCE
from .operators import FENESTRATION
from .operators import _geometry_or_answer
from .operators import _require
from .operators import _wrong_kind

CLEARANCE_MAX_TRIANGLE_PAIRS = 1_600_000_000

CLEARANCE_BUDGET_SECONDS = 20.0

AXIS_ALIGNED_DEGREES = 0.5


def clear_width(model: SpatialModel, a_global_id: str, b_global_id: str) -> Answer[dict[str, Any]]:
    method = f"clearWidth({a_global_id}, {b_global_id})"
    first = _require(model, a_global_id, method)
    second = _require(model, b_global_id, method)

    if a_global_id == b_global_id:
        return _same_element(a_global_id, method)

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
        return _degenerate(model, empty, a_global_id, b_global_id, method)

    pairs = len(tris_a) * len(tris_b)
    if pairs > CLEARANCE_MAX_TRIANGLE_PAIRS:
        return _too_fine(tris_a, tris_b, a_global_id, b_global_id, method)

    started = time.perf_counter()
    value, point_a, point_b, tested, aborted = _soup_distance(tris_a, tris_b, CLEARANCE_BUDGET_SECONDS)
    seconds = time.perf_counter() - started

    if aborted:
        return _aborted(seconds, tris_a, tris_b, tested, a_global_id, b_global_id, method)

    gap = box_gap(geo_a.box, geo_b.box)
    box_distance = float(np.linalg.norm(np.maximum(gap, 0.0)))

    caveat = _clear_width_caveat(value, first, second, box_distance)

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


def _clear_width_caveat(value: float, first: Any, second: Any, box_distance: float) -> str:
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
    return caveat


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

    projection, measured_on, via = _measured_projection(model, subject, kind)

    if projection is None or measured_on is None:
        return _no_aperture(model, subject, opening_or_filler_global_id, method)

    polygon, normal = projection
    min_x, min_y, max_x, max_y = polygon.bounds
    width = float(max_x - min_x)
    height = float(max_y - min_y)
    area = float(polygon.area)
    filled = area / (width * height) if width > 0 and height > 0 else 0.0

    caveat = _opening_caveat(via, filled)

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


def _measured_projection(model: SpatialModel, subject: Any, kind: str) -> tuple[Any, Any, str]:
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
    return projection, measured_on, via


def _opening_caveat(via: str, filled: float) -> str:
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
    return caveat


def oriented_extent(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"orientedExtent({global_id})"
    subject = _require(model, global_id, method)
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    rectangle = _minimum_area_rectangle(geo.verts[:, :2])
    if rectangle is None:
        return _no_footprint(model, subject, global_id, method)

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

    caveat = _extent_caveat(model, aligned, deviation, box_width, box_depth, box_area, oriented_area)

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


def _extent_caveat(
    model: SpatialModel,
    aligned: bool,
    deviation: float,
    box_width: float,
    box_depth: float,
    box_area: float,
    oriented_area: float,
) -> str:
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
    return caveat


__all__ = [
    "AXIS_ALIGNED_DEGREES",
    "CLEARANCE_BUDGET_SECONDS",
    "CLEARANCE_MAX_TRIANGLE_PAIRS",
    "clear_opening_width",
    "clear_width",
    "oriented_extent",
]
