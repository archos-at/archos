from __future__ import annotations

import heapq
import math
from collections import defaultdict
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations
from typing import Any

from agent.drawings.sheet_probe import MERGE_PT
from agent.drawings.sheet_probe import _intersection
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_scale import Hint
from agent.drawings.sheet_scale import corroborate
from agent.drawings.sheet_scale import decode_region
from agent.drawings.sheet_scale import display_ratio
from agent.drawings.sheet_scale import note_hint
from agent.drawings.sheet_scale import page_box
from agent.drawings.sheet_types import Box
from agent.drawings.sheet_types import Point
from agent.drawings.sheet_types import Sheet

MIN_SEGMENT_PT = 0.5
MAX_SEGMENTS = 20_000
MAX_VERTICES = 30_000
MAX_PAIRED_IN_CELL = 24
_CELL_PT = 16.0
_DIGITS = 5


@dataclass(frozen=True)
class Linework:
    segments: tuple[float, ...]
    vertices: tuple[float, ...]
    total_segments: int
    truncated: bool


def _quantised(point: Point) -> tuple[int, int]:
    return round(point[0] / MERGE_PT), round(point[1] / MERGE_PT)


def _distinct(sheet: Sheet) -> list[tuple[float, float, float, float]]:
    table = sheet.segments
    seen: set[tuple[tuple[int, int], ...]] = set()
    kept: list[tuple[float, float, float, float]] = []
    for index in range(len(table)):
        ends = table.ends(index)
        if math.hypot(ends[2] - ends[0], ends[3] - ends[1]) < MIN_SEGMENT_PT:
            continue
        key = tuple(sorted((_quantised(ends[:2]), _quantised(ends[2:]))))
        if key not in seen:
            seen.add(key)
            kept.append(ends)
    return kept


def _cells_of(ends: tuple[float, float, float, float]) -> set[tuple[int, int]]:
    x0, y0, x1, y1 = ends
    steps = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / (_CELL_PT / 2)))
    return {
        (int((x0 + (x1 - x0) * step / steps) // _CELL_PT), int((y0 + (y1 - y0) * step / steps) // _CELL_PT))
        for step in range(steps + 1)
    }


def _crossings(segments: Sequence[tuple[float, float, float, float]]) -> Iterable[Point]:
    cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, ends in enumerate(segments):
        for cell in _cells_of(ends):
            cells[cell].append(index)
    for (column, row), members in cells.items():
        if len(members) > MAX_PAIRED_IN_CELL:
            continue
        for first, second in combinations(members, 2):
            met = _intersection(segments[first], segments[second])
            if met is not None and (int(met[0] // _CELL_PT), int(met[1] // _CELL_PT)) == (column, row):
                yield met


def _shares(sheet: Sheet, points: Iterable[Point]) -> tuple[float, ...]:
    width, height = sheet.width_pt, sheet.height_pt
    return tuple(value for x, y in points for value in (round(x / width, _DIGITS), round(y / height, _DIGITS)))


def _read_linework(sheet: Sheet) -> Linework:
    distinct = _distinct(sheet)
    truncated = len(distinct) > MAX_SEGMENTS
    if truncated:
        distinct = heapq.nlargest(MAX_SEGMENTS, distinct, key=lambda e: math.hypot(e[2] - e[0], e[3] - e[1]))
    vertices: dict[tuple[int, int], Point] = {}
    ends = (point for e in distinct for point in ((e[0], e[1]), (e[2], e[3])))
    for point in (*ends, *_crossings(distinct)):
        vertices.setdefault(_quantised(point), point)
        if len(vertices) >= MAX_VERTICES:
            truncated = True
            break
    segment_points = (point for e in distinct for point in ((e[0], e[1]), (e[2], e[3])))
    return Linework(_shares(sheet, segment_points), _shares(sheet, vertices.values()), len(sheet.segments), truncated)


def linework(sheet: Sheet) -> Linework:
    found = sheet.memo.get("snap_targets")
    if found is None:
        found = sheet.memo["snap_targets"] = _read_linework(sheet)
    return found


def _region(sheet: Sheet, box: Box) -> list[float] | None:
    if box == page_box(sheet):
        return None
    return [*_shares(sheet, [(box[0], box[1]), (box[2], box[3])])]


def _scale(sheet: Sheet, box: Box, state: str, source: str, metres_per_point: float | None) -> dict[str, Any]:
    return {
        "region": _region(sheet, box),
        "state": state,
        "source": source,
        "metresPerShare": None
        if metres_per_point is None
        else [metres_per_point * sheet.width_pt, metres_per_point * sheet.height_pt],
        "ratio": None if metres_per_point is None else round(display_ratio(metres_per_point), 4),
    }


def _hinted(sheet: Sheet, hint: Hint | str, box: Box) -> dict[str, Any]:
    if isinstance(hint, str):
        return _scale(sheet, box, "uncalibrated", "none", None)
    if not corroborate(sheet, hint).corroborated:
        return _scale(sheet, hint.box, "uncalibrated", hint.source, None)
    return _scale(sheet, hint.box, "estimated", hint.source, hint.metres_per_point)


def scales(sheet: Sheet, calibrations: Sequence[Calibration] = ()) -> list[dict[str, Any]]:
    if sheet.user_unit != 1:
        return []
    found = [_scale(sheet, c.box, "verified", "calibration", c.metres_per_point) for c in calibrations]
    if sheet.scan or not len(sheet.segments):
        return found
    if sheet.regions:
        return found + [_hinted(sheet, decode_region(sheet, region), region.box) for region in sheet.regions]
    return [*found, _hinted(sheet, note_hint(sheet), page_box(sheet))]
