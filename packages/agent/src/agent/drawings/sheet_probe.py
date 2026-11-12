"""Finding linework on a sheet: crossings along a probe, snap points, and the span the engine picks.

The model looks at a rendered crop and places points; it never picks the two
faces a width is measured between. This module does (the build
specification's decision 9), and it refuses rather than guesses:

* :func:`clearance` moves each end along the probe to the ONE linework crossing
  within :data:`SNAP_RADIUS_PT`. Two crossings in reach, or none, and it returns
  the crossings along the probe and no span; the caller then names two by index.
* :func:`snap` moves a point to the ONE line end or line intersection in reach,
  and refuses two. A point that sits on a candidate (within
  :data:`ON_POINT_PT`) and clear of the next takes it: that is how a caller
  answers a refusal, by placing the point on the candidate it was shown.

A cell index over the page holds the segments (:class:`SegmentIndex`), so a probe looks at
the cells it passes and never scans a million segments. Everything is in
points on the page as shown; nothing here knows a scale.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import replace
from itertools import combinations

from agent.drawings.sheet_types import Point
from agent.drawings.sheet_types import SegmentTable
from agent.drawings.sheet_types import Sheet

#: How far an end may be moved to linework, in points (2.1 mm on paper: 21 cm at 1:100).
SNAP_RADIUS_PT = 6.0
#: A point this close to a candidate sits on it.
ON_POINT_PT = 1.0
#: Crossings or snap candidates closer than this are one (two segments meeting at a corner).
MERGE_PT = 0.25
#: A segment within this angle of the probe runs along it and is no face.
MIN_CROSSING_DEGREES = 15.0
#: The most segments within reach of a point whose ends and intersections are told apart; past it the point
#: is refused. Dropping the intersections instead once moved a point off the corner it sat on to a hatch end.
MAX_PAIRED_SEGMENTS = 60
_CELL_PT = 16.0
_EPSILON = 1e-9


class SegmentIndex:
    """The segments of a page by cell, for looking near a place without scanning the page."""

    def __init__(self, table: SegmentTable, width_pt: float, height_pt: float) -> None:
        self.table = table
        self.columns = max(1, math.ceil(width_pt / _CELL_PT))
        self.rows = max(1, math.ceil(height_pt / _CELL_PT))
        cells: dict[int, list[int]] = defaultdict(list)
        for index in range(len(table)):
            for cell in self._cells_along(*table.ends(index)):
                cells[cell].append(index)
        self.cells = dict(cells)

    def _cell(self, x: float, y: float) -> int:
        column = min(max(int(x // _CELL_PT), 0), self.columns - 1)
        row = min(max(int(y // _CELL_PT), 0), self.rows - 1)
        return row * self.columns + column

    def _cells_along(self, x0: float, y0: float, x1: float, y1: float) -> set[int]:
        """The cells a segment passes, sampled every half cell; a corner it only clips is caught by the padded query."""
        steps = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / (_CELL_PT / 2)))
        return {self._cell(x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps) for step in range(steps + 1)}

    def near_box(self, x0: float, y0: float, x1: float, y1: float) -> set[int]:
        """Every segment that may touch the box, grown by one cell."""
        first_column = min(max(int(min(x0, x1) // _CELL_PT) - 1, 0), self.columns - 1)
        last_column = min(max(int(max(x0, x1) // _CELL_PT) + 1, 0), self.columns - 1)
        first_row = min(max(int(min(y0, y1) // _CELL_PT) - 1, 0), self.rows - 1)
        last_row = min(max(int(max(y0, y1) // _CELL_PT) + 1, 0), self.rows - 1)
        found: set[int] = set()
        for row in range(first_row, last_row + 1):
            base = row * self.columns
            for column in range(first_column, last_column + 1):
                found.update(self.cells.get(base + column, ()))
        return found

    def near_line(self, start: Point, end: Point) -> set[int]:
        """Every segment that may touch the line from ``start`` to ``end``: the cells it passes and their neighbours."""
        steps = max(1, math.ceil(math.hypot(end[0] - start[0], end[1] - start[1]) / _CELL_PT))
        found: set[int] = set()
        for step in range(steps + 1):
            x = start[0] + (end[0] - start[0]) * step / steps
            y = start[1] + (end[1] - start[1]) * step / steps
            found |= self.near_box(x, y, x, y)
        return found


def index_of(sheet: Sheet) -> SegmentIndex:
    """The sheet's cell index, built once and kept with the sheet."""
    index = sheet.memo.get("index")
    if index is None:
        index = sheet.memo["index"] = SegmentIndex(sheet.segments, sheet.width_pt, sheet.height_pt)
    return index


@dataclass(frozen=True)
class Crossing:
    """Where the probe meets a piece of linework: how far along, where, and what the line looks like."""

    along: float
    point: Point
    width: float
    dashed: bool
    fill_edge: bool
    colour: int
    degrees: float
    segment: int


def _meet(start: Point, unit: Point, length: float, ends: tuple[float, float, float, float]) -> tuple | None:
    """Where the probe (``start`` + t·``unit``, t in 0..``length``) meets a segment: ``(t, degrees)`` or None."""
    ax, ay, bx, by = ends
    sx, sy = bx - ax, by - ay
    seg_length = math.hypot(sx, sy)
    denominator = unit[0] * sy - unit[1] * sx
    if seg_length < _EPSILON or abs(denominator) < _EPSILON * seg_length:
        return None
    t = ((ax - start[0]) * sy - (ay - start[1]) * sx) / denominator
    u = ((ax - start[0]) * unit[1] - (ay - start[1]) * unit[0]) / denominator
    slack = 0.01 / seg_length
    if not (-0.01 <= t <= length + 0.01 and -slack <= u <= 1 + slack):
        return None
    degrees = math.degrees(math.asin(min(1.0, abs(denominator) / seg_length)))
    return t, degrees


def _merged(crossings: list[Crossing]) -> list[Crossing]:
    """Crossings in order along the probe; those at one place are one, the line standing squarest to the probe kept."""
    merged: list[Crossing] = []
    for crossing in sorted(crossings, key=lambda item: item.along):
        if not merged or crossing.along - merged[-1].along > MERGE_PT:
            merged.append(crossing)
        elif (crossing.degrees, crossing.width) > (merged[-1].degrees, merged[-1].width):
            merged[-1] = replace(crossing, along=merged[-1].along, point=merged[-1].point)
    return merged


def crossings(sheet: Sheet, start: Point, end: Point) -> list[Crossing]:
    """Every piece of linework the line from ``start`` to ``end`` crosses, in order; ``along`` is from ``start``."""
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    if length < _EPSILON:
        return []
    unit = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)
    table = sheet.segments
    found: list[Crossing] = []
    for index in index_of(sheet).near_line(start, end):
        met = _meet(start, unit, length, table.ends(index))
        if met is None or met[1] < MIN_CROSSING_DEGREES:
            continue
        segment = table.segment(index)
        point = (start[0] + unit[0] * met[0], start[1] + unit[1] * met[0])
        found.append(
            Crossing(met[0], point, segment.width, segment.dashed, segment.fill_edge, segment.colour, met[1], index)
        )
    return _merged(found)


@dataclass(frozen=True)
class Span:
    """The one span a probe measures: two crossings, how far each end was moved, and what lies between.

    ``points`` are the ends of what is measured. Between two parallel lines
    that is the perpendicular from the first crossing to the other line: a
    width does not grow because the two points were placed a little askew.
    Between lines that are not parallel it is the piece of the probe between
    them, and ``askew_degrees`` says by how much they differ.
    """

    start: Crossing
    end: Crossing
    moved: tuple[float, float]
    inside: int
    points: tuple[Point, Point]
    askew_degrees: float

    @property
    def length_pt(self) -> float:
        return math.dist(*self.points)

    @property
    def widest_stroke_pt(self) -> float:
        return max(self.start.width, self.end.width)


@dataclass(frozen=True)
class Undecided:
    """No span: what lies along the probe, for the caller to choose from, and why none was chosen."""

    crossings: tuple[Crossing, ...]
    reason: str


def _extended(start: Point, end: Point) -> tuple[Point, Point, float]:
    """The probe grown by the snap radius at both ends, and its original length."""
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    unit = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)
    reach = SNAP_RADIUS_PT
    return (
        (start[0] - unit[0] * reach, start[1] - unit[1] * reach),
        (end[0] + unit[0] * reach, end[1] + unit[1] * reach),
        length,
    )


#: Two lines within this angle of each other are parallel faces.
PARALLEL_DEGREES = 1.0
#: A probe must meet both lines at least this squarely. Flatter, and what it crosses is no pair of faces a
#: width is taken between (two ticks along a dimension line), or the points were placed too far askew to
#: say which width was meant: no span is picked.
SQUARE_DEGREES = 65.0


def _between_faces(table: SegmentTable, start: Crossing, end: Crossing) -> tuple[tuple[Point, Point], float]:
    """The ends of the span between two crossed lines, and the angle between the lines.

    Between parallel lines the span is the perpendicular from the first
    crossing to the other line; between lines that are not parallel it is the
    piece of the probe between them.
    """
    ax, ay, bx, by = table.ends(start.segment)
    cx, cy, dx, dy = table.ends(end.segment)
    first, second = math.atan2(by - ay, bx - ax), math.atan2(dy - cy, dx - cx)
    askew = abs(math.degrees(first - second)) % 180
    askew = min(askew, 180 - askew)
    if askew > PARALLEL_DEGREES:
        return (start.point, end.point), askew
    length = math.hypot(dx - cx, dy - cy)
    ux, uy = (dx - cx) / length, (dy - cy) / length
    along = (start.point[0] - cx) * ux + (start.point[1] - cy) * uy
    return (start.point, (cx + along * ux, cy + along * uy)), askew


def _span(sheet: Sheet, found: Sequence[Crossing], first: int, second: int, length: float) -> Span | Undecided:
    low, high = sorted((first, second))
    start, end = found[low], found[high]
    slant = min(start.degrees, end.degrees)
    if slant < SQUARE_DEGREES:
        return Undecided(
            tuple(found),
            f"the line between the two points meets a line at {slant:.0f} degrees: place the two points square "
            "across the two faces, or measure between line ends with `distance`",
        )
    moved = (abs(start.along - SNAP_RADIUS_PT), abs(end.along - SNAP_RADIUS_PT - length))
    points, askew = _between_faces(sheet.segments, start, end)
    return Span(start, end, moved, high - low - 1, points, askew)


def clearance(sheet: Sheet, start: Point, end: Point, between: Sequence[int] | None = None) -> Span | Undecided:
    """The span between the two faces ``start`` and ``end`` were placed near, or what lies along the probe.

    ``between`` names two crossings by their index in the list a refused call
    returned (the same call without ``between`` returns the same list).
    """
    if math.hypot(end[0] - start[0], end[1] - start[1]) < MERGE_PT:
        return Undecided((), "the two points are the same place")
    probe_start, probe_end, length = _extended(start, end)
    found = crossings(sheet, probe_start, probe_end)
    if between is not None:
        if len(between) != 2 or between[0] == between[1] or not all(0 <= index < len(found) for index in between):
            return Undecided(tuple(found), f"`between` must name two different crossings of the {len(found)} listed")
        return _span(sheet, found, between[0], between[1], length)
    at_start = [i for i, crossing in enumerate(found) if abs(crossing.along - SNAP_RADIUS_PT) <= SNAP_RADIUS_PT]
    at_end = [i for i, crossing in enumerate(found) if abs(crossing.along - SNAP_RADIUS_PT - length) <= SNAP_RADIUS_PT]
    if len(at_start) == 1 and len(at_end) == 1 and at_start != at_end:
        return _span(sheet, found, at_start[0], at_end[0], length)
    return Undecided(tuple(found), _why_undecided(len(at_start), len(at_end)))


def _why_undecided(at_start: int, at_end: int) -> str:
    def said(count: int, which: str) -> str:
        return f"no linework within reach of the {which} point" if count == 0 else f"{count} lines within reach of it"

    if at_start == 1 and at_end == 1:
        return "both points reach the same line"
    parts = [said(count, which) for count, which in ((at_start, "first"), (at_end, "second")) if count != 1]
    return "; ".join(parts)


@dataclass(frozen=True)
class Snapped:
    """A point moved to linework: where it landed, how far it moved, and the widest stroke meeting there."""

    point: Point
    moved: float
    width: float


@dataclass(frozen=True)
class Unsnapped:
    """A point that was not moved: the candidates in reach (nearest first), and why none was taken."""

    candidates: tuple[Point, ...]
    reason: str


def _intersection(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> Point | None:
    ax, ay, bx, by = first
    cx, cy, dx, dy = second
    denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
    if abs(denominator) < _EPSILON:
        return None
    t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator
    u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator
    if not (0 <= t <= 1 and 0 <= u <= 1):
        return None
    return ax + t * (bx - ax), ay + t * (by - ay)


def _distance_to(ends: tuple[float, float, float, float], point: Point) -> float:
    ax, ay, bx, by = ends
    length_squared = (bx - ax) ** 2 + (by - ay) ** 2
    share = 0.0 if length_squared == 0 else ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / length_squared
    share = min(max(share, 0.0), 1.0)
    return math.dist((ax + share * (bx - ax), ay + share * (by - ay)), point)


def _in_reach(sheet: Sheet, point: Point) -> list[int]:
    """The segments that pass within the snap radius of ``point``."""
    table = sheet.segments
    reach = SNAP_RADIUS_PT
    near = index_of(sheet).near_box(point[0] - reach, point[1] - reach, point[0] + reach, point[1] + reach)
    return sorted(index for index in near if _distance_to(table.ends(index), point) <= reach)


def _candidates(sheet: Sheet, near: Sequence[int], point: Point) -> list[tuple[Point, float]]:
    """Line ends and line intersections within the snap radius of ``point``, each with the stroke width there."""
    table = sheet.segments
    raw: list[tuple[Point, float]] = list(_pair_intersections(table, near))
    for index in near:
        x0, y0, x1, y1 = table.ends(index)
        raw.extend((((x0, y0), table.widths[index]), ((x1, y1), table.widths[index])))
    return [(place, width) for place, width in raw if math.dist(place, point) <= SNAP_RADIUS_PT]


def _pair_intersections(table: SegmentTable, near: Sequence[int]) -> Iterable[tuple[Point, float]]:
    for first, second in combinations(near, 2):
        met = _intersection(table.ends(first), table.ends(second))
        if met is not None:
            yield met, max(table.widths[first], table.widths[second])


def _clustered(candidates: list[tuple[Point, float]], point: Point) -> list[tuple[Point, float]]:
    """Candidates at one place merged (the widest stroke kept), nearest to ``point`` first."""
    merged: list[tuple[Point, float]] = []
    for place, width in sorted(candidates, key=lambda item: math.dist(item[0], point)):
        twin = next((i for i, (kept, _) in enumerate(merged) if math.dist(kept, place) <= MERGE_PT), None)
        if twin is None:
            merged.append((place, width))
        elif width > merged[twin][1]:
            merged[twin] = (merged[twin][0], width)
    return merged


def snap(sheet: Sheet, point: Point) -> Snapped | Unsnapped:
    """``point`` moved to the one line end or intersection in reach; refused when there are two, or none."""
    near = _in_reach(sheet, point)
    if len(near) > MAX_PAIRED_SEGMENTS:
        return Unsnapped(
            (), f"{len(near)} lines pass within reach of the point: too many to tell its corners apart (hatching?)"
        )
    found = _clustered(_candidates(sheet, near, point), point)
    if not found:
        return Unsnapped((), "no line end or intersection within reach of the point")
    nearest, width = found[0]
    distance = math.dist(nearest, point)
    alone = len(found) == 1
    on_it = distance <= ON_POINT_PT and (alone or math.dist(found[1][0], point) - distance >= ON_POINT_PT)
    if alone or on_it:
        return Snapped(nearest, distance, width)
    places = tuple(place for place, _ in found)
    return Unsnapped(places, f"{len(found)} line ends or intersections within reach; place the point on one of them")


def polyline_length(points: Sequence[Point]) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:], strict=False))


def polygon_area(points: Sequence[Point]) -> float:
    """The area the points enclose, in square points (the shoelace formula)."""
    ring = [*points, points[0]]
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:], strict=False))) / 2


def is_simple(points: Sequence[Point]) -> bool:
    """Whether the closed outline through ``points`` crosses itself nowhere: corners given in order."""
    ring = [*points, points[0]]
    edges = [(*a, *b) for a, b in zip(ring, ring[1:], strict=False)]
    count = len(edges)
    for first, second in combinations(range(count), 2):
        adjacent = second - first == 1 or (first == 0 and second == count - 1)
        if not adjacent and _intersection(edges[first], edges[second]) is not None:
            return False
    return True
