"""Characters into figures: the pieces of printed text on a sheet, each whole and in reading order.

A figure is a run of characters on one baseline, read along the direction its
text advances in: a dimension („2,385“), a level mark, a room name with its
area, a scale note. This module groups and orders; it decides nothing about
what a figure means (that is ``agent.drawings.sheet_figures``).

What a plot does that a naive reader gets wrong:

* **File order is not reading order.** Some plots write a rotated figure one
  character at a time, back to front; read in file order a printed 185 comes
  back as „581“. The characters of a run are ordered by their place along the
  advance direction, which the text matrix gives, never by file order.
* **A raised final digit belongs to its figure.** The half centimetre of a
  dimension is printed small and raised („2,38⁵“). It is ONE digit, smaller,
  starting where a number ends, above its baseline; it is put back after that
  number, written as a superscript, and named in ``raised``. Nothing else is:
  a footnote marker after a word, a second figure set a little higher, the 2
  of „m²“ stay what they are.
* **Direction is per figure.** A sheet holds text at any angle, and a view
  drawn rotated holds figures along its own axes. Every extent is measured in
  the text's own frame (its baseline origin, advance and up vector), never from
  an axis-aligned box.
* **A baseline is local.** Two lines of a room stamp are nine points apart; a
  third text elsewhere on the sheet, a point lower than the first, must not
  join them. A character joins a run only when it continues that run: same
  baseline, and starting where the run ends.

Pure: tuples in, dicts out, no PDF library. The characters are those of
:func:`knowledge_layer.sheet.reader.read_characters`, on the page as shown
(points, origin top left, y down).
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any

#: A gap along the baseline wider than this share of the text height ends a figure.
_FIGURE_GAP = 0.8
#: A gap wider than this share of the height is a space inside a figure.
_SPACE_GAP = 0.15
#: Characters whose baselines differ by less than this share of the height are on one line.
_BASELINE_TOLERANCE = 0.12
#: A raised digit is at most this share of its figure's height, and sits this far above the baseline (shares).
_RAISED_MAX_SIZE = 0.85
_RAISED_MIN_RISE = 0.15
_RAISED_MAX_RISE = 0.9
_RAISED_MAX_GAP = 0.5
_SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
_NUMBER_END = re.compile(r"(?:^|\s)\d+(?:[.,]\d+)?$")
_HASH_CELL = 24.0

# Fields of a character tuple, as the reader writes them.
_TEXT, _OX, _OY, _X0, _Y0, _X1, _Y1, _DX, _DY, _SIZE, _ADVANCE, _UX, _UY = range(13)


class _Run:
    """One run being built: characters on one baseline, in one direction, in reading order."""

    __slots__ = ("bucket", "chars", "dx", "dy", "raised", "rise", "size", "u_end", "u_start", "ux", "uy")

    def __init__(self, bucket: int, frame: tuple[float, float, float, float], rise: float, size: float) -> None:
        self.bucket, self.rise, self.size = bucket, rise, size
        self.dx, self.dy, self.ux, self.uy = frame
        #: ``(start along the baseline, end, character, raised)``.
        self.chars: list[tuple[float, float, tuple, bool]] = []
        self.u_start = self.u_end = 0.0
        self.raised = ""

    def add(self, u_start: float, char: tuple) -> None:
        if not self.chars:
            self.u_start = u_start
        self.chars.append((u_start, u_start + char[_ADVANCE], char, False))
        self.u_end = max(self.u_end, u_start + char[_ADVANCE]) if len(self.chars) > 1 else u_start + char[_ADVANCE]

    def continues(self, u_start: float, rise: float, size: float) -> bool:
        """Whether a character starting at ``u_start`` on baseline ``rise`` is the next of this run."""
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
        """A place on the run's baseline, on the page as shown."""
        return along * self.dx + self.rise * self.ux, along * self.dy + self.rise * self.uy


def _direction_buckets(characters: list[tuple]) -> dict[int, list[tuple]]:
    """Characters by direction, to the degree; two neighbouring degrees are one direction."""
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
    """The bucket's own frame: its mean advance direction, and the up vector on the side its glyphs stand."""
    dx = sum(char[_DX] for char in characters)
    dy = sum(char[_DY] for char in characters)
    length = math.hypot(dx, dy) or 1.0
    dx, dy = dx / length, dy / length
    # Perpendicular to the advance, on the side the text matrix says is up (a mirrored text stands the other way).
    side = sum(char[_UX] * dy - char[_UY] * dx for char in characters)
    return (dx, dy, dy, -dx) if side >= 0 else (dx, dy, -dy, dx)


def _runs_of(bucket: int, characters: list[tuple]) -> list[_Run]:
    """One direction's characters as runs. Each character joins the run it continues, or starts one.

    Characters are taken in order along the advance direction; the runs still
    open (one could continue them) are few, so each character looks at a
    handful. A run a character lies a figure's gap beyond is closed.
    """
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
    """Drop the runs of a band no later character can continue: the scan moves along the advance direction."""
    band[:] = [run for run in band if u_start - run.u_end <= _FIGURE_GAP * run.size * 1.43]


def _cell(point: tuple[float, float]) -> tuple[int, int]:
    return int(point[0] // _HASH_CELL), int(point[1] // _HASH_CELL)


def _number_ends(run: _Run) -> list[int]:
    """The positions in a run where a number ends: a digit not followed by another digit or a separator."""
    texts = [char[_TEXT] for _, _, char, _ in run.chars] + [" "]
    return [
        position
        for position in range(len(run.chars))
        if texts[position].isdigit() and not (texts[position + 1].isdigit() or texts[position + 1] in ".,")
    ]


def _digit_ends(runs: list[_Run]) -> dict[tuple[int, int, int], list[tuple[_Run, int]]]:
    """Where each number in a run ends: ``(run, position of its last digit)`` by the grid cell of that digit's end."""
    ends: dict[tuple[int, int, int], list[tuple[_Run, int]]] = defaultdict(list)
    for run in runs:
        for position in _number_ends(run):
            ends[(run.bucket, *_cell(run.place(run.chars[position][1])))].append((run, position))
    return ends


def _raises(tail: _Run, run: _Run, position: int) -> bool:
    """Whether ``tail`` is the raised digit of the number ending at ``position`` of ``run``."""
    if run is tail or run.raised or not _NUMBER_END.search(run.text(position + 1)):
        return False
    lift = (tail.rise - run.rise) / run.size
    gap = (tail.u_start - run.chars[position][1]) / run.size
    small = tail.size <= _RAISED_MAX_SIZE * run.size
    return small and _RAISED_MIN_RISE <= lift <= _RAISED_MAX_RISE and -0.15 <= gap <= _RAISED_MAX_GAP


def _attach_raised(runs: list[_Run]) -> list[_Run]:
    """Put each raised digit back after the number it ends; returns the runs left."""
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
        # Counter-clockwise as a reader sees the page: 0 reads left to right, 90 reads bottom to top.
        "angle": round(math.degrees(math.atan2(-run.dy, run.dx))) % 360,
        "direction": (run.dx, run.dy),
        "height": run.size,
    }


def group_figures(characters: list[tuple]) -> list[dict[str, Any]]:
    """The figures the characters form, top to bottom and left to right on the page as shown.

    Each figure: ``text`` as printed (a raised digit as a superscript, where
    it stands), ``raised`` (that digit, plain, or empty), ``box`` and
    ``centre`` in points, ``angle`` in degrees, ``direction`` as a unit vector
    (y down) and ``height``, the text height in points.
    """
    runs: list[_Run] = []
    for bucket, members in _direction_buckets(characters).items():
        runs.extend(_runs_of(bucket, members))
    figures = [_figure(run) for run in _attach_raised(runs)]
    figures.sort(key=lambda figure: (round(figure["centre"][1] / 4.0), figure["centre"][0]))
    return figures
