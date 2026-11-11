"""A drawing sheet as values: its frame, linework, printed figures and stored scale regions.

One frame everywhere: the page as a viewer shows it, in points, origin top
left, y down. A place crosses a boundary (the tool's arguments, an annotation,
an answer) as shares of that page; inside the engine it is points.

Nothing here imports outside the standard library, and nothing of
``knowledge_layer``: the reader (``knowledge_layer.sheet``) returns plain
tuples, dicts and ``array`` columns, and :func:`sheet_from_plain` is where they
become these types (the import contract ``agent-knowledge-port`` counts an
annotation import too).
"""

from __future__ import annotations

import math
from array import array
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

Point = tuple[float, float]
Box = tuple[float, float, float, float]

#: Bits of a segment's flags, as the reader writes them.
DASHED = 1
FILL_EDGE = 2


@dataclass(frozen=True)
class Segment:
    """One straight piece of linework: its ends, stroke width in points, and how it is painted."""

    x0: float
    y0: float
    x1: float
    y1: float
    width: float
    dashed: bool
    fill_edge: bool
    colour: int

    @property
    def length(self) -> float:
        return math.hypot(self.x1 - self.x0, self.y1 - self.y0)


@dataclass(frozen=True)
class Figure:
    """One piece of printed text, whole: as printed, with its place, direction and height.

    ``text`` holds a raised final digit as a superscript; ``raised`` names
    those digits plainly, or is empty. ``angle`` is counter-clockwise as a
    reader sees the page; ``direction`` is the same as a unit vector (y down).
    """

    text: str
    raised: str
    box: Box
    centre: Point
    angle: int
    direction: Point
    height: float


@dataclass(frozen=True)
class StoredRegion:
    """A region the file itself stores a scale for (a viewport with a measure dictionary), undecoded.

    ``x`` and ``y`` are the number format arrays as ``(unit label, factor)``
    pairs; ``y`` is None when the file has none, which is the only form a
    scale is read from.
    """

    box: Box
    name: str
    subtype: str
    ratio: str
    x: tuple[tuple[str, float], ...]
    y: tuple[tuple[str, float], ...] | None
    cyx: float | None


class SegmentTable:
    """A page's linework as columns: a million segments are four arrays, not a million objects."""

    def __init__(self, coords: array, widths: array, flags: array, colours: array) -> None:
        self.coords, self.widths, self.flags, self.colours = coords, widths, flags, colours

    def __len__(self) -> int:
        return len(self.widths)

    def ends(self, index: int) -> tuple[float, float, float, float]:
        base = 4 * index
        return self.coords[base], self.coords[base + 1], self.coords[base + 2], self.coords[base + 3]

    def segment(self, index: int) -> Segment:
        flags = self.flags[index]
        return Segment(
            *self.ends(index), self.widths[index], bool(flags & DASHED), bool(flags & FILL_EDGE), self.colours[index]
        )

    @classmethod
    def of(cls, segments: Sequence[Segment]) -> SegmentTable:
        """A table from segments, for tests and small sheets."""
        coords = array("d", (value for s in segments for value in (s.x0, s.y0, s.x1, s.y1)))
        flags = array("B", ((DASHED if s.dashed else 0) | (FILL_EDGE if s.fill_edge else 0) for s in segments))
        return cls(coords, array("f", (s.width for s in segments)), flags, array("L", (s.colour for s in segments)))


@dataclass(frozen=True)
class Sheet:
    """One page of a drawing, read: everything a measurement needs and nothing of the PDF."""

    width_pt: float
    height_pt: float
    width_mm: float
    height_mm: float
    format: str | None
    rotation: int
    user_unit: float
    segments: SegmentTable
    figures: tuple[Figure, ...]
    regions: tuple[StoredRegion, ...]
    scan: bool
    #: Filled lazily by ``sheet_probe.index_of`` and ``sheet_scale``: derived values, kept with the sheet they are of.
    memo: dict[str, Any] = field(default_factory=dict, compare=False, repr=False)

    def point(self, share: Sequence[float]) -> Point:
        """A place given as shares of the page, in points."""
        return share[0] * self.width_pt, share[1] * self.height_pt

    def share(self, point: Point) -> tuple[float, float]:
        """A place in points, as shares of the page rounded to what a tool argument carries."""
        return round(point[0] / self.width_pt, 5), round(point[1] / self.height_pt, 5)

    def share_box(self, box: Box) -> tuple[float, float, float, float]:
        """A box in points as ``[x, y, w, h]`` shares of the page."""
        x0, y0 = self.share((box[0], box[1]))
        x1, y1 = self.share((box[2], box[3]))
        return x0, y0, round(x1 - x0, 5), round(y1 - y0, 5)


def _figure(plain: Mapping[str, Any]) -> Figure:
    return Figure(
        text=plain["text"],
        raised=plain["raised"],
        box=tuple(plain["box"]),
        centre=tuple(plain["centre"]),
        angle=int(plain["angle"]),
        direction=tuple(plain["direction"]),
        height=float(plain["height"]),
    )


def _region(plain: Mapping[str, Any]) -> StoredRegion:
    return StoredRegion(
        box=tuple(plain["box"]),
        name=plain["name"],
        subtype=plain["subtype"],
        ratio=plain["ratio"],
        x=tuple((unit, float(factor)) for unit, factor in plain["x"]),
        y=None if plain["y"] is None else tuple((unit, float(factor)) for unit, factor in plain["y"]),
        cyx=plain["cyx"],
    )


def sheet_from_plain(plain: Mapping[str, Any], figures: Sequence[Mapping[str, Any]]) -> Sheet:
    """A :class:`Sheet` from what the reader returned for a page and the figures grouped from its characters."""
    page, segments = plain["page"], plain["segments"]
    return Sheet(
        width_pt=page["width_pt"],
        height_pt=page["height_pt"],
        width_mm=page["width_mm"],
        height_mm=page["height_mm"],
        format=page["format"],
        rotation=page["rotation"],
        user_unit=page["user_unit"],
        segments=SegmentTable(segments["coords"], segments["width"], segments["flags"], segments["colour"]),
        figures=tuple(_figure(figure) for figure in figures),
        regions=tuple(_region(region) for region in plain["regions"]),
        scan=bool(plain["scan"]),
    )
