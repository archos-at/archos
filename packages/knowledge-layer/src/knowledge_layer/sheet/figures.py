from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any

_FIGURE_GAP = 0.8
_SPACE_GAP = 0.15
_BASELINE_TOLERANCE = 0.12
_RAISED_MAX_SIZE = 0.85
_RAISED_MIN_RISE = 0.15
_RAISED_MAX_RISE = 0.9
_RAISED_MAX_GAP = 0.5
_SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
_NUMBER_END = re.compile(r"(?:^|\s)\d+(?:[.,]\d+)?$")
_HASH_CELL = 24.0

_TEXT, _OX, _OY, _X0, _Y0, _X1, _Y1, _DX, _DY, _SIZE, _ADVANCE, _UX, _UY = range(13)


class _Run:
    __slots__ = ("bucket", "chars", "dx", "dy", "raised", "rise", "size", "u_end", "u_start", "ux", "uy")

    def __init__(self, bucket: int, frame: tuple[float, float, float, float], rise: float, size: float) -> None:
        self.bucket, self.rise, self.size = bucket, rise, size
        self.dx, self.dy, self.ux, self.uy = frame
        self.chars: list[tuple[float, float, tuple, bool]] = []
        self.u_start = self.u_end = 0.0
        self.raised = ""

    def add(self, u_start: float, char: tuple) -> None:
        if not self.chars:
            self.u_start = u_start
        self.chars.append((u_start, u_start + char[_ADVANCE], char, False))
        self.u_end = max(self.u_end, u_start + char[_ADVANCE]) if len(self.chars) > 1 else u_start + char[_ADVANCE]

    def continues(self, u_start: float, rise: float, size: float) -> bool:
        same_line = abs(rise - self.rise) <= _BASELINE_TOLERANCE * min(size, self.size)
        near = -0.5 * self.size <= u_start - self.u_end <= _FIGURE_GAP * max(size, self.size)
        return same_line and near and 0.7 <= size / self.size <= 1.43

    def text(self, upto: int | None = None) -> str:
        parts: list[str] = []
        previous_end: float | None = None
        for u_start, u_end, char, raised in self.chars[:upto]:
            if previous_end is not None and u_start - previous_end > _SPACE_GAP * self.size:
                parts.append(" ")
            parts.append(char[_TEXT].translate(_SUPERSCRIPT) if raised else char[_TEXT])
            previous_end = u_end
        return "".join(parts)

    def place(self, along: float) -> tuple[float, float]:
        return along * self.dx + self.rise * self.ux, along * self.dy + self.rise * self.uy


def _direction_buckets(characters: list[tuple]) -> dict[int, list[tuple]]:
    by_degree: dict[int, list[tuple]] = defaultdict(list)
    for char in characters:
        degree = round(math.degrees(math.atan2(char[_DY], char[_DX]))) % 360
        by_degree[degree].append(char)
    merged: dict[int, list[tuple]] = {}
    for degree in sorted(by_degree):
        home = degree - 1 if degree - 1 in merged else degree
        if degree == 359 and 0 in merged:
            home = 0
        merged.setdefault(home, []).extend(by_degree[degree])
    return merged


def _frame_of(characters: list[tuple]) -> tuple[float, float, float, float]:
    dx = sum(char[_DX] for char in characters)
    dy = sum(char[_DY] for char in characters)
    length = math.hypot(dx, dy) or 1.0
    dx, dy = dx / length, dy / length
    side = sum(char[_UX] * dy - char[_UY] * dx for char in characters)
    return (dx, dy, dy, -dx) if side >= 0 else (dx, dy, -dy, dx)


def _runs_of(bucket: int, characters: list[tuple]) -> list[_Run]:
    frame = _frame_of(characters)
    dx, dy, ux, uy = frame
    placed = sorted((char[_OX] * dx + char[_OY] * dy, char[_OX] * ux + char[_OY] * uy, char) for char in characters)
    runs: list[_Run] = []
    open_runs: dict[int, list[_Run]] = defaultdict(list)
    for u_start, rise, char in placed:
        size = char[_SIZE]
        band = round(rise / max(size, 1.0))
        near = [run for key in (band - 1, band, band + 1) for run in open_runs[key]]
        home = next((run for run in near if run.continues(u_start, rise, size)), None)
        if home is None:
            home = _Run(bucket, frame, rise, size)
            runs.append(home)
            _close_stale(open_runs[band], u_start)
            open_runs[band].append(home)
        home.add(u_start, char)
    return runs


def _close_stale(band: list[_Run], u_start: float) -> None:
    band[:] = [run for run in band if u_start - run.u_end <= _FIGURE_GAP * run.size * 1.43]


def _cell(point: tuple[float, float]) -> tuple[int, int]:
    return int(point[0] // _HASH_CELL), int(point[1] // _HASH_CELL)


def _number_ends(run: _Run) -> list[int]:
    texts = [char[_TEXT] for _, _, char, _ in run.chars] + [" "]
    return [
        position
        for position in range(len(run.chars))
        if texts[position].isdigit() and not (texts[position + 1].isdigit() or texts[position + 1] in ".,")
    ]


def _digit_ends(runs: list[_Run]) -> dict[tuple[int, int, int], list[tuple[_Run, int]]]:
    ends: dict[tuple[int, int, int], list[tuple[_Run, int]]] = defaultdict(list)
    for run in runs:
        for position in _number_ends(run):
            ends[(run.bucket, *_cell(run.place(run.chars[position][1])))].append((run, position))
    return ends


def _raises(tail: _Run, run: _Run, position: int) -> bool:
    if run is tail or run.raised or not _NUMBER_END.search(run.text(position + 1)):
        return False
    lift = (tail.rise - run.rise) / run.size
    gap = (tail.u_start - run.chars[position][1]) / run.size
    small = tail.size <= _RAISED_MAX_SIZE * run.size
    return small and _RAISED_MIN_RISE <= lift <= _RAISED_MAX_RISE and -0.15 <= gap <= _RAISED_MAX_GAP


def _attach_raised(runs: list[_Run]) -> list[_Run]:
    ends = _digit_ends(runs)
    absorbed: set[int] = set()
    for tail in runs:
        if len(tail.chars) != 1 or not tail.chars[0][2][_TEXT].isdigit():
            continue
        cx, cy = _cell(tail.place(tail.u_start))
        near = (found for i in (-1, 0, 1) for j in (-1, 0, 1) for found in ends.get((tail.bucket, cx + i, cy + j), ()))
        owner = next(((run, at) for run, at in near if id(run) not in absorbed and _raises(tail, run, at)), None)
        if owner is None:
            continue
        run, position = owner
        u_start, u_end, char, _ = tail.chars[0]
        run.chars.insert(position + 1, (u_start, u_end, char, True))
        run.raised = char[_TEXT]
        absorbed.add(id(tail))
    return [run for run in runs if id(run) not in absorbed]


def _figure(run: _Run) -> dict[str, Any]:
    boxes = [char[_X0 : _Y1 + 1] for _, _, char, _ in run.chars]
    x0, y0 = min(box[0] for box in boxes), min(box[1] for box in boxes)
    x1, y1 = max(box[2] for box in boxes), max(box[3] for box in boxes)
    return {
        "text": run.text(),
        "raised": run.raised,
        "box": (x0, y0, x1, y1),
        "centre": ((x0 + x1) / 2, (y0 + y1) / 2),
        "angle": round(math.degrees(math.atan2(-run.dy, run.dx))) % 360,
        "direction": (run.dx, run.dy),
        "height": run.size,
    }


def group_figures(characters: list[tuple]) -> list[dict[str, Any]]:
    runs: list[_Run] = []
    for bucket, members in _direction_buckets(characters).items():
        runs.extend(_runs_of(bucket, members))
    figures = [_figure(run) for run in _attach_raised(runs)]
    figures.sort(key=lambda figure: (round(figure["centre"][1] / 4.0), figure["centre"][0]))
    return figures
