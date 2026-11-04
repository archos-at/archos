"""The sheet around a drawing: frame, title block, scale bar and north arrow (ADR-0152).

Laid out the way a plotted sheet is, so the PDF reads as a drawing an office
would hand on rather than a screenshot of one. The frame follows ISO 5457 (a
20 mm filing margin on the left, 10 mm elsewhere). Along its foot runs one band
of cells: the north arrow (for a georeferenced drawing only), the scale bar with
the scale under it, the notes, and the title block proper, whose fields carry a
small label above each value as a Schriftfeld does. On a narrow sheet the notes
take a row of their own above the rest. Under the frame, in the margin, one quiet
line names what made the sheet (``house_style``).

Everything here is in millimetres on the page, drawn into one axes that spans
it. Copy is German: this page is a document for the office.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass
from dataclasses import field

from matplotlib.axes import Axes
from matplotlib.figure import Figure
from matplotlib.font_manager import FontProperties
from matplotlib.patches import Circle
from matplotlib.patches import FancyBboxPatch
from matplotlib.patches import Polygon
from matplotlib.patches import Rectangle

from .house_style import INK
from .house_style import INK_MUTED
from .house_style import ON_INK
from .house_style import HouseStyle
from .house_style import house_style
from .sheet import NOTES_ROW_MM
from .sheet import Sheet
from .sheet import scale_bar_metres

_PT_PER_MM = 72.0 / 25.4

NORTH_CELL_MM = 24.0
SCALE_CELL_MM = 58.0
TITLE_CELL_MM = 132.0

#: The app icon's tile at the sheet's foot, and its corner (20/96 of the side, as the brand's icon).
_ICON_MM = 3.4


@dataclass(frozen=True)
class SheetField:
    """One labelled value in the title block, ``span`` columns wide out of three."""

    label: str
    value: str
    span: int = 1


@dataclass(frozen=True)
class SheetFacts:
    """What the title band says."""

    title: str
    subtitle: str
    first_row: list[SheetField]
    second_row: list[SheetField]
    notes: list[str] = field(default_factory=list)
    scale: int | None = None
    #: Why there is no scale, when there is none.
    unscaled_reason: str = ""
    #: Whether up is (grid) north, so the arrow may be drawn.
    north_up: bool = False
    #: Set on a page with no drawing (the parcel list): shown where the scale bar would be.
    page_label: str = ""


def _mm(width_mm: float) -> float:
    return width_mm * _PT_PER_MM


@dataclass(frozen=True)
class SheetPen:
    """Writes on a page axes in millimetres, in the house type and ink."""

    axes: Axes
    style: HouseStyle

    def text(self, x: float, y: float, text: str, size: float, face: FontProperties, **kwargs: object) -> None:
        props = face.copy()
        props.set_size(size)
        self.axes.text(x, y, text, fontproperties=props, color=kwargs.pop("color", INK), **kwargs)

    def line(self, xs: tuple[float, float], ys: tuple[float, float], width_mm: float = 0.18) -> None:
        self.axes.plot(xs, ys, color=INK, lw=_mm(width_mm), solid_capstyle="butt")


def draw_sheet(figure: Figure, sheet: Sheet, facts: SheetFacts) -> None:
    """Frame, title band and its cells, on top of the drawing."""
    width, height = sheet.page_mm
    axes = figure.add_axes((0.0, 0.0, 1.0, 1.0), zorder=10)
    axes.set_axis_off()
    axes.set_xlim(0.0, width)
    axes.set_ylim(0.0, height)
    axes.patch.set_alpha(0.0)
    page = SheetPen(axes, house_style())

    left, bottom, right, top = sheet.frame_mm
    axes.add_patch(Rectangle((left, bottom), right - left, top - bottom, fill=False, lw=_mm(0.5), ec=INK))
    band_top = bottom + sheet.title_band_mm
    page.line((left, right), (band_top, band_top), 0.35)

    row_top = band_top
    if not sheet.is_wide:
        row_top = band_top - NOTES_ROW_MM
        page.line((left, right), (row_top, row_top))
        _notes(page, left, row_top, right, band_top, facts.notes)
    x = left
    if facts.north_up:
        _north_arrow(page, x, bottom, x + NORTH_CELL_MM, row_top)
        x += NORTH_CELL_MM
        page.line((x, x), (bottom, row_top))
    _scale_cell(page, x, bottom, x + SCALE_CELL_MM, row_top, facts)
    x += SCALE_CELL_MM
    page.line((x, x), (bottom, row_top))
    title_left = max(x, right - TITLE_CELL_MM) if sheet.is_wide else x
    if sheet.is_wide:
        _notes(page, x, bottom, title_left, row_top, facts.notes)
        page.line((title_left, title_left), (bottom, row_top))
    _title_cell(page, title_left, bottom, right, row_top, facts)
    _maker(page, right, bottom)


def _fit(text: str, width_mm: float, size_pt: float) -> str:
    """Cut a line to what fits, by an average glyph width of half the size."""
    capacity = max(int(width_mm / (size_pt * 0.52 / _PT_PER_MM)), 4)
    return text if len(text) <= capacity else text[: capacity - 1].rstrip() + "…"


def _title_cell(page: SheetPen, left: float, bottom: float, right: float, top: float, facts: SheetFacts) -> None:
    pad, width, style = 3.0, right - left, page.style
    page.text(left + pad, top - 2.8, _fit(facts.title, width - 2 * pad, 11), 11, style.semibold, va="top")
    page.text(
        left + pad, top - 8.0, _fit(facts.subtitle, width - 2 * pad, 6), 6, style.regular, va="top", color=INK_MUTED
    )
    head_bottom = top - 11.5
    page.line((left, right), (head_bottom, head_bottom))
    row_height = (head_bottom - bottom) / 2
    for index, row in enumerate((facts.first_row, facts.second_row)):
        row_top = head_bottom - index * row_height
        if index:
            page.line((left, right), (row_top, row_top))
        _field_row(page, left, row_top - row_height, right, row_top, row)


def _field_row(page: SheetPen, left: float, bottom: float, right: float, top: float, fields: list[SheetField]) -> None:
    column, x, style = (right - left) / 3, left, page.style
    for index, item in enumerate(fields):
        width = column * item.span
        if index:
            page.line((x, x), (bottom, top))
        page.text(x + 2.2, top - 1.5, item.label, 4.8, style.medium, va="top", color=INK_MUTED)
        page.text(x + 2.2, bottom + 1.7, _fit(item.value, width - 4.4, 7.5), 7.5, style.regular, va="bottom")
        x += width


def _notes(page: SheetPen, left: float, bottom: float, right: float, top: float, notes: list[str]) -> None:
    if not notes:
        return
    pad, style = 3.0, page.style
    page.text(left + pad, top - 1.5, "Hinweise", 4.8, style.medium, va="top", color=INK_MUTED)
    capacity = max(int((right - left - 2 * pad) / (6.0 * 0.5 / _PT_PER_MM)), 20)
    lines = [line for note in notes for line in textwrap.wrap(note, capacity)]
    max_lines = max(int((top - bottom - 5.0) / 2.55), 1)
    if len(lines) > max_lines:
        lines = [*lines[: max_lines - 1], _fit(lines[max_lines - 1] + " …", right - left - 2 * pad, 6)]
    for row, line in enumerate(lines):
        page.text(left + pad, top - 5.0 - row * 2.55, line, 6, style.regular, va="top")


def _scale_cell(page: SheetPen, left: float, bottom: float, right: float, top: float, facts: SheetFacts) -> None:
    centre, middle, style = (left + right) / 2, (bottom + top) / 2, page.style
    if facts.page_label:
        page.text(centre, middle, facts.page_label, 7.5, style.medium, ha="center", va="center")
        return
    if facts.scale is None:
        page.text(centre, middle + 2.0, "Nicht maßstäblich", 7.5, style.semibold, ha="center")
        for row, line in enumerate(textwrap.wrap(facts.unscaled_reason, 34)[:2]):
            page.text(centre, middle - 2.5 - row * 2.4, line, 5.5, style.regular, ha="center", color=INK_MUTED)
        return
    metres = scale_bar_metres(facts.scale)
    length = metres * 1000.0 / facts.scale
    x0, y0 = centre - length / 2, middle + 0.8
    for index in range(4):
        face = INK if index % 2 == 0 else "white"
        page.axes.add_patch(Rectangle((x0 + index * length / 4, y0), length / 4, 1.5, fc=face, ec=INK, lw=_mm(0.15)))
    for fraction, label in ((0.0, "0"), (0.5, _number(metres / 2)), (1.0, f"{_number(metres)} m")):
        page.text(x0 + fraction * length, y0 + 2.5, label, 5.5, style.regular, ha="center", va="bottom")
    scale = f"M 1:{facts.scale:,}".replace(",", ".")
    page.text(centre, y0 - 2.4, scale, 8, style.semibold, ha="center", va="top")


def _number(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def _north_arrow(page: SheetPen, left: float, bottom: float, right: float, top: float) -> None:
    cx, cy, radius = (left + right) / 2, bottom + (top - bottom) * 0.46, 5.6
    page.axes.add_patch(Circle((cx, cy), radius, fill=False, ec=INK, lw=_mm(0.18)))
    tip, base, notch = (cx, cy + radius * 0.92), cy - radius * 0.72, (cx, cy - radius * 0.28)
    page.axes.add_patch(Polygon([tip, (cx - radius * 0.46, base), notch], closed=True, fc=INK, ec=INK, lw=_mm(0.15)))
    page.axes.add_patch(
        Polygon([tip, (cx + radius * 0.46, base), notch], closed=True, fc="white", ec=INK, lw=_mm(0.15))
    )
    page.text(cx, cy + radius + 1.0, "N", 8, page.style.semibold, ha="center", va="bottom")
    page.text(cx, bottom + 1.8, "Gitternord", 4.8, page.style.medium, ha="center", va="bottom", color=INK_MUTED)


def _maker(page: SheetPen, right: float, frame_bottom: float) -> None:
    """„Erstellt mit …“ and the app icon, right-aligned in the margin under the frame."""
    name = page.style.product_name
    if not name:
        return
    middle = frame_bottom / 2
    icon_left = right - _ICON_MM
    corner = _ICON_MM * 20 / 96
    page.axes.add_patch(
        FancyBboxPatch(
            (icon_left, middle - _ICON_MM / 2),
            _ICON_MM,
            _ICON_MM,
            boxstyle=f"round,pad=0,rounding_size={corner}",
            fc=INK,
            ec="none",
        )
    )
    page.text(
        icon_left + _ICON_MM / 2, middle, name[0], 6.2, page.style.mark, ha="center", va="center_baseline", color=ON_INK
    )
    page.text(
        icon_left - 1.3,
        middle,
        f"Erstellt mit {name}",
        5.5,
        page.style.regular,
        ha="right",
        va="center_baseline",
        color=INK_MUTED,
    )
