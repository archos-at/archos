"""One floor drawn at known dimensions into a sheet, and the true value of every probe placed on it.

A :class:`FloorView` is a small floor (two rooms, a hatched outer wall, a
partition with a door and its swing, furniture, two rows of dimension chains
on two sides) drawn at ``drawn_scale`` anywhere on a page, at any angle. What
the view SAYS about its scale is separate from how it is drawn: ``stored_scale``
is what a stored region states, and the label style is how its figures are
printed. A view whose statements are false is the point of half the set.

:meth:`FloorView.truths` lists probes as a caller of the measuring tool would
place them (shares of the page as shown) with the value each was drawn at.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from dataclasses import field
from typing import Literal

from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import dimension

#: One point on paper, in metres.
PAPER_M_PER_PT = 0.0254 / 72
#: The control distance of a quarter circle drawn as one Bézier.
_QUARTER = 0.5523
#: How far inside a room, in points, a clearance probe's ends are placed from the faces.
INSET_PT = 2.5

Operation = Literal["clearance", "distance", "path", "area"]
Labels = Literal["half", "rounded", "centimetres", "whole"]
Share = tuple[float, float]


@dataclass(frozen=True)
class Truth:
    """One probe and the value it was drawn at: metres, or square metres for an area.

    ``region`` is the index of the sheet's region the probe lies in. A probe
    with ``refuse`` set has no true value at all (it crosses two views): any
    number stated for it is wrong.
    """

    name: str
    operation: Operation
    places: tuple[Share, ...]
    value: float
    region: int = 0
    refuse: str = ""


def printed(metres: float, labels: Labels) -> tuple[str, str]:
    """A length as the view prints it: ``(body, raised digit)``.

    ``half``: metres with two decimals from one metre up and centimetres
    below, to the half centimetre (a raised 5). ``rounded``: the same forms to
    the whole centimetre. ``centimetres``: centimetres throughout, to the half.
    ``whole``: centimetres throughout, whole numbers only.
    """
    if labels in ("rounded", "whole"):
        whole_cm, raised = math.floor(metres * 100 + 0.5), ""
    else:
        half_cm = math.floor(metres * 200 + 0.5)
        whole_cm, raised = half_cm // 2, "5" if half_cm % 2 else ""
    if labels in ("half", "rounded") and metres >= 1:
        return f"{whole_cm // 100},{whole_cm % 100:02d}", raised
    return str(whole_cm), raised


@dataclass
class FloorView:
    """A floor of ``size`` metres drawn at 1:``drawn_scale`` with its lower left outer corner at ``origin``."""

    page: SheetPage
    origin: tuple[float, float]
    drawn_scale: float
    #: What the stored region states, as the N of 1:N; None stores no region.
    stored_scale: float | None = None
    stored_unit: str = "m"
    angle: float = 0.0
    labels: Labels = "half"
    hatching: bool = True
    dimensioned: bool = True
    #: Dimension the floor as equal bays, this many along its width and its depth, where a floor is otherwise
    #: dimensioned wall by wall: a row of equal spans whose labels all round the same way.
    bays: tuple[int, int] | None = None
    #: Draw the outer chain too: the one overall dimension along each side.
    overall: bool = True
    #: Outer width and depth, and where the partition's left face runs.
    size: tuple[float, float, float] = (9.6, 6.2, 4.3)
    wall: float = 0.3
    partition: float = 0.12
    #: Every dimension drawn: ``(true metres, printed text)``.
    dimensions: list[tuple[float, str]] = field(default_factory=list, init=False)

    DOOR_M = 0.9
    TABLE = (1.6, 0.8)

    @property
    def metres_per_point(self) -> float:
        """What one point of the page is in the floor's metres, as drawn."""
        return self.drawn_scale * PAPER_M_PER_PT

    def at(self, x_m: float, y_m: float) -> tuple[float, float]:
        """A place on the floor (metres) in the page's user space."""
        cos, sin = math.cos(math.radians(self.angle)), math.sin(math.radians(self.angle))
        x, y = x_m / self.metres_per_point, y_m / self.metres_per_point
        return self.origin[0] + x * cos - y * sin, self.origin[1] + x * sin + y * cos

    def share(self, x_m: float, y_m: float) -> Share:
        return self.page.shown_share(*self.at(x_m, y_m))

    def _line(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.page.line(*self.at(x0, y0), *self.at(x1, y1))

    def _box(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.page.polyline([self.at(x0, y0), self.at(x1, y0), self.at(x1, y1), self.at(x0, y1)], close=True)

    # --- where things are, in metres of the floor ---------------------------------

    @property
    def door_from(self) -> float:
        return self.wall + 0.6

    @property
    def table_at(self) -> tuple[float, float]:
        return self.size[2] + self.partition + 1.4, self.wall + 1.2

    def corners(self) -> list[tuple[float, float]]:
        """The corners of everything the view draws, its dimension chains and their figures included."""
        width, depth, _ = self.size
        low = -2.6 if self.dimensioned else -0.3
        return [(low, low), (width + 0.3, low), (width + 0.3, depth + 0.3), (low, depth + 0.3)]

    def stations(self) -> tuple[list[float], list[float]]:
        """Where the inner dimension chains break, along the width and along the depth."""
        width, depth, left = self.size
        if self.bays is not None:
            return (
                [width * step / self.bays[0] for step in range(self.bays[0] + 1)],
                [depth * step / self.bays[1] for step in range(self.bays[1] + 1)],
            )
        wall = self.wall
        return [0.0, wall, left, left + self.partition, width - wall, width], [0.0, wall, depth - wall, depth]

    # --- drawing -------------------------------------------------------------------

    def draw(self) -> None:
        width, depth, left = self.size
        wall, right = self.wall, left + self.partition
        self.page.style(width=0.5)
        self._box(0, 0, width, depth)
        self._box(wall, wall, width - wall, depth - wall)
        self._partition(left, right)
        self._door(left)
        self._furniture()
        if self.hatching:
            self._hatch_walls()
        if self.dimensioned:
            across, up = self.stations()
            self._chain(across, "x", 0.9)
            self._chain(up, "y", 0.9)
        if self.dimensioned and self.overall:
            self._chain([0.0, width], "x", 1.8)
            self._chain([0.0, depth], "y", 1.8)
        if self.stored_scale is not None:
            self._store_region()

    def _partition(self, left: float, right: float) -> None:
        low, high = self.door_from, self.door_from + self.DOOR_M
        for x in (left, right):
            self._line(x, self.wall, x, low)
            self._line(x, high, x, self.size[1] - self.wall)
        self._line(left, low, right, low)
        self._line(left, high, right, high)

    def _door(self, hinge_x: float) -> None:
        """The leaf, open into the left room, and the quarter circle of its swing."""
        low, reach = self.door_from, self.DOOR_M
        self.page.style(width=0.25)
        self._line(hinge_x, low, hinge_x - reach, low)
        self.page.curve(
            self.at(hinge_x - reach, low),
            self.at(hinge_x - reach, low + reach * _QUARTER),
            self.at(hinge_x - reach * _QUARTER, low + reach),
            self.at(hinge_x, low + reach),
        )

    def _furniture(self) -> None:
        x, y = self.table_at
        self.page.style(width=0.25)
        self._box(x, y, x + self.TABLE[0], y + self.TABLE[1])
        # A bed with its pillow line, in the left room's far corner.
        bed_x, bed_y = self.wall + 0.2, self.size[1] - self.wall - 1.2
        self._box(bed_x, bed_y, bed_x + 2.0, bed_y + 1.0)
        self._line(bed_x + 0.4, bed_y, bed_x + 0.4, bed_y + 1.0)

    def _hatch_walls(self) -> None:
        width, depth, _ = self.size
        wall = self.wall
        self.page.style(width=0.1)
        self._hatch(0, 0, width, wall)
        self._hatch(0, depth - wall, width, depth)
        self._hatch(0, wall, wall, depth - wall)
        self._hatch(width - wall, wall, width, depth - wall)

    def _hatch(self, x0: float, y0: float, x1: float, y1: float) -> None:
        """45-degree hatching of a wall band, three points apart, each line ending on the band's faces."""
        step = 3.0 * self.metres_per_point
        reach = x0 + y0 + step
        while reach < x1 + y1:
            start_x, end_x = min(reach - y0, x1), max(reach - y1, x0)
            self._line(start_x, reach - start_x, end_x, reach - end_x)
            reach += step

    def _chain(self, stations: list[float], along: str, offset: float) -> None:
        for first, second in zip(stations, stations[1:], strict=False):
            if along == "x":
                self._dimension((first, 0.0), (second, 0.0), (0.0, -offset))
            else:
                self._dimension((0.0, second), (0.0, first), (-offset, 0.0))

    def _dimension(self, start: tuple[float, float], end: tuple[float, float], offset: tuple[float, float]) -> None:
        """A dimension of the span ``start``-``end`` (metres), its line moved off the floor by ``offset`` metres."""
        metres = math.dist(start, end)
        body, raised = printed(metres, self.labels)
        a = self.at(start[0] + offset[0], start[1] + offset[1])
        b = self.at(end[0] + offset[0], end[1] + offset[1])
        self.page.style(width=0.18)
        self.page.line(*self.at(*start), *a)
        self.page.line(*self.at(*end), *b)
        dimension(self.page, a, b, body, raised=raised)
        self.dimensions.append((metres, body + ("⁵" if raised else "")))

    def user_box(self) -> tuple[float, float, float, float]:
        """The view's extent in the page's user space, as a ``/BBox``."""
        placed = [self.at(*corner) for corner in self.corners()]
        xs, ys = [x for x, _ in placed], [y for _, y in placed]
        return min(xs), min(ys), max(xs), max(ys)

    def shown_box(self) -> tuple[float, float, float, float]:
        """The view's extent on the page as shown, in points: the box a person's calibration is drawn over."""
        placed = [self.page.shown(*self.at(*corner)) for corner in self.corners()]
        xs, ys = [x for x, _ in placed], [y for _, y in placed]
        return min(xs), min(ys), max(xs), max(ys)

    def _store_region(self) -> None:
        unit_metres = {"m": 1.0, "cm": 0.01, "mm": 0.001}[self.stored_unit]
        self.page.viewport(
            self.user_box(),
            units_per_point=self.stored_scale * PAPER_M_PER_PT / unit_metres,
            unit=self.stored_unit,
            ratio=f"1:{self.stored_scale:g}",
            name="Floor",
        )

    # --- the probes and what each was drawn at ---------------------------------------

    def truths(self, prefix: str, region: int) -> list[Truth]:
        """Every probe on this view with its true value, the clearances first."""
        found = [*self._clearances(), *self._snapped(), *self._along_a_dimension()]
        return [
            Truth(f"{prefix}/{name}", operation, tuple(self.share(*place) for place in places), value, region)
            for name, operation, places, value in found
        ]

    def _clearances(self) -> list[tuple[str, Operation, list[tuple[float, float]], float]]:
        width, depth, left = self.size
        wall, right = self.wall, left + self.partition
        inset = INSET_PT * self.metres_per_point
        above_door = self.door_from + self.DOOR_M + 0.8
        through_table = self.table_at[1] + 0.5
        middle = (left + right) / 2
        return [
            ("room_a_width", "clearance", [(wall + inset, above_door), (left - inset, above_door)], left - wall),
            (
                "room_a_depth",
                "clearance",
                [(wall + 1.0, wall + inset), (wall + 1.0, depth - wall - inset)],
                depth - 2 * wall,
            ),
            (
                "room_b_width_over_table",
                "clearance",
                [(right + inset, through_table), (width - wall - inset, through_table)],
                width - wall - right,
            ),
            (
                "door_opening",
                "clearance",
                [(middle, self.door_from + inset), (middle, self.door_from + self.DOOR_M - inset)],
                self.DOOR_M,
            ),
            ("outer_wall_thickness", "clearance", [(-inset, above_door), (wall + inset, above_door)], wall),
        ]

    def _along_a_dimension(self) -> list[tuple[str, Operation, list[tuple[float, float]], float]]:
        """A probe laid along the longest span of the inner chain: the one place a printed figure lies on a span."""
        if not self.dimensioned:
            return []
        across, _ = self.stations()
        start, end = max(zip(across, across[1:], strict=False), key=lambda pair: pair[1] - pair[0])
        inset = INSET_PT * self.metres_per_point
        return [("along_a_dimension", "clearance", [(start + inset, -0.9), (end - inset, -0.9)], end - start)]

    def _snapped(self) -> list[tuple[str, Operation, list[tuple[float, float]], float]]:
        width, depth, left = self.size
        wall, right = self.wall, left + self.partition
        (x, y), (long, short) = self.table_at, self.TABLE
        room_a = [(wall, wall), (left, wall), (left, depth - wall), (wall, depth - wall)]
        room_b = [(right, wall), (width - wall, wall), (width - wall, depth - wall), (right, depth - wall)]
        table = [(x, y), (x + long, y), (x + long, y + short), (x, y + short)]
        return [
            ("room_a_south_wall", "distance", room_a[:2], left - wall),
            ("table_length", "distance", table[:2], long),
            ("building_length", "distance", [(0.0, 0.0), (width, 0.0)], width),
            ("table_two_sides", "path", table[:3], long + short),
            ("room_a_area", "area", room_a, (left - wall) * (depth - 2 * wall)),
            ("room_b_area", "area", room_b, (width - wall - right) * (depth - 2 * wall)),
            ("table_area", "area", table, long * short),
        ]
