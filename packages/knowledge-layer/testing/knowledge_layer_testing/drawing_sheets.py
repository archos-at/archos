"""Drawing sheets written at known dimensions: the ground truth the measuring engine is held to.

Each sheet is drawn from lengths in metres at a stated scale, so every span
has a true value a test can compare a measurement with. What a real sheet
carries is here on purpose: dimension chains with ticks and extension lines,
figures in the mixed convention (metres as decimals, centimetres as whole
numbers, a raised half centimetre), a level mark, an opening size, room
stamps, a door swing, furniture, optional hatching, a stored scale region and
a printed scale note.

These measure the ENGINE, not anybody's drafting: the constants they confirm
stay provisional until real plots are measured.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from dataclasses import field

from knowledge_layer_testing.sheet_fixtures import A1_LANDSCAPE
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import dimension

#: One point on paper, in metres.
PAPER_M_PER_PT = 0.0254 / 72


def label(metres: float) -> str:
    """A length as a construction drawing prints it: decimals of a metre from one metre up, centimetres below,
    and a raised 5 for a half centimetre (the caller draws the raised digit; this returns ``"2,38^5"``)."""
    half_cm = round(metres * 200)
    whole_cm, half = divmod(half_cm, 2)
    raised = "^5" if half else ""
    if metres >= 1:
        return f"{whole_cm // 100},{whole_cm % 100:02d}{raised}"
    return f"{whole_cm}{raised}"


@dataclass
class FloorSheet:
    """A floor drawn at ``scale`` on an A1 sheet, with what a test needs to know about it.

    ``replot`` draws everything at that factor of its true size while the
    stored region and the printed figures stay as they were: a file plotted
    again at another paper size with its viewports intact. ``stored_factor``
    scales only the stored region's factor: a region that states a wrong scale.
    """

    scale: int = 100
    rotate: int = 0
    cropped: bool = False
    stored_region: bool = True
    stored_unit: str = ""
    stored_factor: float = 1.0
    scale_note: bool = True
    replot: float = 1.0
    hatching: bool = False
    view_angle: float = 0.0
    origin: tuple[float, float] = (420.0, 520.0)
    page: SheetPage = field(init=False)
    #: Every dimension drawn: ``(true metres, printed label)``.
    dimensions: list[tuple[float, str]] = field(default_factory=list, init=False)

    #: The corridor's clear width and where its two faces run, in metres of the floor.
    CORRIDOR = (3.0, 4.2)
    WIDTH_M = 10.0
    LINING_M = 0.1
    DEPTH_M = 6.0

    def __post_init__(self) -> None:
        boxes = {"media_box": (0.0, 0.0, *A1_LANDSCAPE)}
        if self.cropped:
            boxes = {
                "media_box": (-40.0, -30.0, A1_LANDSCAPE[0] + 60, A1_LANDSCAPE[1] + 50),
                "crop_box": (0.0, 0.0, *A1_LANDSCAPE),
            }
        self.page = SheetPage(rotate=self.rotate, **boxes)
        self._draw()

    @property
    def true_metres_per_point(self) -> float:
        """What one point of the sheet as drawn is in the floor's metres."""
        return self.scale * PAPER_M_PER_PT / self.replot

    def at(self, x_m: float, y_m: float) -> tuple[float, float]:
        """A place on the floor (metres) in the page's user space."""
        points = self.replot / (self.scale * PAPER_M_PER_PT)
        cos, sin = math.cos(math.radians(self.view_angle)), math.sin(math.radians(self.view_angle))
        x, y = x_m * points, y_m * points
        return self.origin[0] + x * cos - y * sin, self.origin[1] + x * sin + y * cos

    def share(self, x_m: float, y_m: float) -> tuple[float, float]:
        """A place on the floor as shares of the page as shown: what a tool argument carries."""
        return self.page.shown_share(*self.at(x_m, y_m))

    def _wall(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.page.line(*self.at(x0, y0), *self.at(x1, y1))

    def _dimension(self, start: tuple[float, float], end: tuple[float, float], offset: tuple[float, float]) -> None:
        """A dimension of the span ``start``-``end`` (metres), its line moved off the floor by ``offset`` metres."""
        metres = math.dist(start, end)
        text = label(metres)
        a = self.at(start[0] + offset[0], start[1] + offset[1])
        b = self.at(end[0] + offset[0], end[1] + offset[1])
        body, _, raised = text.partition("^")
        self.page.style(width=0.18)
        self.page.line(*self.at(*start), *a)
        self.page.line(*self.at(*end), *b)
        dimension(self.page, a, b, body, raised=raised)
        self.dimensions.append((metres, text.replace("^5", "⁵")))

    def _chain(self, stations: list[float], along: str, offset: float) -> None:
        for first, second in zip(stations, stations[1:], strict=False):
            if along == "x":
                self._dimension((first, 0.0), (second, 0.0), (0.0, -offset))
            else:
                self._dimension((0.0, second), (0.0, first), (-offset, 0.0))

    def _draw(self) -> None:
        low, high = self.CORRIDOR
        page = self.page
        page.style(width=0.5)
        page.polyline(
            [self.at(0, 0), self.at(self.WIDTH_M, 0), self.at(self.WIDTH_M, self.DEPTH_M), self.at(0, self.DEPTH_M)],
            close=True,
        )
        self._wall(0, low, self.WIDTH_M, low)
        self._wall(0, high, self.WIDTH_M, high)
        self._wall(4.0, 0, 4.0, low)
        self._wall(4.5, 0, 4.5, low)
        # A second line a few centimetres inside the right wall: a finish layer, two lines within one reach.
        self._wall(self.WIDTH_M - self.LINING_M, 0, self.WIDTH_M - self.LINING_M, low)
        self._chain([0.0, 4.0, 4.5, self.WIDTH_M], "x", 0.9)
        self._chain([0.0, 7.385, self.WIDTH_M], "x", 1.8)
        self._chain([0.0, low, high, self.DEPTH_M], "y", 0.9)
        page.style(width=0.25)
        page.curve(self.at(1.0, low), self.at(1.0, low - 0.5), self.at(1.4, low - 0.9), self.at(1.9, low - 0.9))
        page.rect(*self.at(6.0, 0.8), 40 * self.replot, 25 * self.replot)
        page.text(*self.at(1.2, 1.6), "Wohnen", size=9)
        page.text(*self.at(1.2, 1.2), "12,00 m2", size=9)
        page.text(*self.at(6.0, 2.2), "Zimmer", size=9)
        page.text(*self.at(6.0, 1.8), "16,50 m2", size=9)
        page.text(*self.at(8.5, 5.0), "+3,25", size=7)
        page.text(*self.at(2.0, 5.0), "90/210", size=7)
        if self.hatching:
            self._hatch()
        if self.scale_note:
            page.text(1900, 120, f"M 1:{self.scale}", size=14)
        if self.stored_region:
            self._store_region()

    def _hatch(self) -> None:
        """Dense 45-degree hatching over the whole floor, three points apart: what a section or a filled wall adds."""
        self.page.style(width=0.1)
        step_m = 3.0 * self.true_metres_per_point
        count = int((self.WIDTH_M + self.DEPTH_M) / step_m)
        for index in range(1, count):
            reach = index * step_m
            start = (min(reach, self.WIDTH_M), max(0.0, reach - self.WIDTH_M))
            end = (max(0.0, reach - self.DEPTH_M), min(reach, self.DEPTH_M))
            self._wall(*start, *end)

    def _store_region(self) -> None:
        corners = [
            self.at(-3.0, -3.0),
            self.at(self.WIDTH_M + 2.0, -3.0),
            self.at(self.WIDTH_M + 2.0, self.DEPTH_M + 2.0),
            self.at(-3.0, self.DEPTH_M + 2.0),
        ]
        xs, ys = [corner[0] for corner in corners], [corner[1] for corner in corners]
        unit_metres = {"": 1.0, "m": 1.0, "cm": 0.01, "mm": 0.001}.get(self.stored_unit, 1.0)
        self.page.viewport(
            (min(xs), min(ys), max(xs), max(ys)),
            units_per_point=self.scale * PAPER_M_PER_PT * self.stored_factor / unit_metres,
            unit=self.stored_unit,
            ratio=f"1:{self.scale}",
            name="Floor",
        )
