"""The vector variant of the visual eval's fixture drawings: text and lines as PDF page objects.

``render_fixture_drawings.py`` draws a raster page, the harder case for a model that looks. A CAD
export is the other shape: every figure is characters in the file's text layer and every wall a
stroked path. A drawing of ``drawings.json`` that says ``"render": "vector"`` is written here, from
the same elements and the same boxes, with the sheet writer the reader's own tests use
(``knowledge_layer_testing.sheet_fixtures``). What changes for the model is that ``look`` can return
the printed figures of its crop as text, exactly.

Two element fields only a vector drawing reads: a ``dimension`` may carry ``line`` (``[x0, y0, x1,
y1]`` in shares of the page), the dimension line its figure belongs to, drawn with a tick at each
end; and any text may carry ``angle: 90`` to read bottom to top. A vector sheet is drawn true to the
scale its title block states, so a later measurement has a ground truth.

A drawing that says ``"render": "ground_truth"`` is not drawn from its elements at all: it is one sheet
of the measuring engine's ground-truth set (``knowledge_layer_testing.ground_truth_sheets``), the one
its ``builder`` names, with walls, a door swing, furniture and dimension chains at known dimensions.
Its elements are only the gold boxes of the rows that ask about it.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "packages" / "knowledge-layer" / "testing"))

from knowledge_layer_testing.sheet_fixtures import SheetPage  # noqa: E402
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf  # noqa: E402

POINTS_PER_MM = 72 / 25.4
#: Helvetica's average advance, as a share of the font size: enough to fit a text in its box.
_ADVANCE = 0.55
_CIRCLE = 0.5523  # the control distance of a quarter circle drawn as one Bézier


class _Sheet:
    """A page addressed in shares of the page as shown (origin top left), drawn into user space."""

    def __init__(self, width_mm: float, height_mm: float) -> None:
        self.width, self.height = width_mm * POINTS_PER_MM, height_mm * POINTS_PER_MM
        self.page = SheetPage(media_box=(0.0, 0.0, self.width, self.height))

    def point(self, x: float, y: float) -> tuple[float, float]:
        return x * self.width, (1 - y) * self.height

    def area(self, box: list[float]) -> tuple[float, float, float, float]:
        """A box in shares as ``(left, bottom, width, height)`` in points."""
        x, y, w, h = box
        left, top = self.point(x, y)
        return left, top - h * self.height, w * self.width, h * self.height

    def text(self, box: list[float], text: str, angle: int = 0) -> None:
        """``text`` in ``box``, as large as fits, left aligned and centred across; ``angle`` 90 reads upward."""
        left, bottom, width, height = self.area(box)
        along, across = (height, width) if angle == 90 else (width, height)
        size = min(across * 0.7, along * 0.96 / (max(len(text), 1) * _ADVANCE))
        if angle == 90:
            self.page.text(left + width / 2 + size * 0.35, bottom + 1, text, size=size, angle=90)
        else:
            self.page.text(left + 1, bottom + height / 2 - size * 0.35, text, size=size)

    def frame(self, box: list[float], weight: float) -> None:
        self.page.style(width=weight)
        self.page.rect(*self.area(box))

    def line(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.page.line(*self.point(x0, y0), *self.point(x1, y1))


def _door(sheet: _Sheet, box: list[float]) -> None:
    """The leaf and the quarter circle of its swing, hinged at the box's bottom left."""
    left, bottom, width, height = sheet.area(box)
    side = min(width, height)
    sheet.page.style(width=0.5)
    sheet.page.line(left, bottom, left, bottom + side)
    sheet.page.curve(
        (left, bottom + side),
        (left + side * _CIRCLE, bottom + side),
        (left + side, bottom + side * _CIRCLE),
        (left + side, bottom),
    )


def _symbol(sheet: _Sheet, box: list[float], symbol: str) -> None:
    left, bottom, width, height = sheet.area(box)
    side = min(width, height)
    bottom += (height - side) / 2
    sheet.page.style(width=0.5)
    if symbol == "hatched_square":
        sheet.page.rect(left, bottom, side, side)
        for step in range(1, 5):
            offset = side * step / 5
            sheet.page.line(left + offset, bottom, left, bottom + offset)
            sheet.page.line(left + side, bottom + offset, left + offset, bottom + side)
    elif symbol == "circle_cross":
        sheet.page.rect(left, bottom, side, side)
        sheet.page.line(left, bottom, left + side, bottom + side)
        sheet.page.line(left, bottom + side, left + side, bottom)
    elif symbol == "triangle":
        sheet.page.polyline([(left, bottom), (left + side, bottom), (left + side / 2, bottom + side)], close=True)
    else:
        raise ValueError(f"unknown legend symbol {symbol!r}")


def _dimension(sheet: _Sheet, element: dict[str, Any]) -> None:
    sheet.text(element["box"], element["text"], element.get("angle", 0))
    if "line" not in element:
        return
    x0, y0, x1, y1 = element["line"]
    (ax, ay), (bx, by) = sheet.point(x0, y0), sheet.point(x1, y1)
    sheet.page.style(width=0.25)
    sheet.page.line(ax, ay, bx, by)
    for x, y in ((ax, ay), (bx, by)):
        sheet.page.line(x - 2.5, y - 2.5, x + 2.5, y + 2.5)


def draw_element(sheet: _Sheet, element: dict[str, Any]) -> None:
    kind, box = element["kind"], element["box"]
    if kind == "room":
        sheet.frame(box, 1.0)
        x, y, w, _ = box
        sheet.text([x + 0.004, y + 0.006, w * 0.9, w / 8 * sheet.width / sheet.height], element["text"])
    elif kind == "dimension":
        _dimension(sheet, element)
    elif kind in ("note", "title_field"):
        sheet.text(box, element["text"], element.get("angle", 0))
    elif kind == "door":
        _door(sheet, box)
    elif kind in ("legend_frame", "title_block"):
        sheet.frame(box, 0.5)
        if kind == "legend_frame":
            x, y, w, _ = box
            sheet.text([x + 0.004, y + 0.006, w * 0.9, w / 6 * sheet.width / sheet.height], element["text"])
    elif kind == "legend_entry":
        x, y, w, h = box
        _symbol(sheet, [x, y, w * 0.22, h], element["symbol"])
        sheet.text([x + w * 0.26, y, w * 0.74, h], element["text"])
    elif kind != "plan_area":
        raise ValueError(f"unknown element kind {kind!r}")


def render_ground_truth_pdf(drawing: dict[str, Any]) -> bytes:
    """The sheet of the ground-truth set the drawing names, as PDF bytes."""
    from knowledge_layer_testing import ground_truth_sheets

    builders = {build.__name__: build for build in ground_truth_sheets.BUILDERS}
    if drawing.get("builder") not in builders:
        raise ValueError(f"{drawing['file_name']}: builder must be one of {', '.join(sorted(builders))}")
    return build_sheet_pdf([builders[drawing["builder"]]().page])


def render_vector_pdf(spec: dict[str, Any], drawing: dict[str, Any]) -> bytes:
    """The drawing as PDF bytes: one vector page per spec page, sized as the sheet is."""
    width_mm, height_mm = spec["sheets"][drawing["sheet"]]
    pages = []
    for page in drawing["pages"]:
        sheet = _Sheet(width_mm, height_mm)
        sheet.frame([0.0, 0.0, 1.0, 1.0], 1.0)
        for element in page["elements"]:
            draw_element(sheet, element)
        pages.append(sheet.page)
    return build_sheet_pdf(pages)
