"""The „Grundstücke“ pages: every parcel of a Katastralmappe, as text (ADR-0152).

The drawing shows the parcels; this lists them, with what the map alone can
tell: the number, the cadastral community, which cadastre it is in, its area as
drawn, and the parcels that share a boundary with it in this extract. It is real
text on a PDF page of the rendition, so the index reads it and a citation opens
at it: what makes "how big is 123/4, and who are its neighbours?" answerable
from the uploaded file, with nothing else built for it.

Set on A4 upright sheets in the same frame and title block as the drawing. The
area is labelled for what it is: computed from the boundary as drawn, graphic in
the Grundsteuerkataster, and never the land register's Flächenausmaß.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace

from matplotlib.figure import Figure

from .house_style import INK_MUTED
from .house_style import house_style
from .parcels import Parcel
from .sheet import PAPERS_MM
from .sheet import Sheet
from .title_block import SheetFacts
from .title_block import SheetField
from .title_block import SheetPen
from .title_block import draw_sheet

#: What "Fläche lt. Mappe" is, said where the numbers are.
AREA_NOTE = (
    "Fläche lt. Mappe: aus der gezeichneten Grenze berechnet, nicht das Flächenausmaß des Grundbuchs. "
    "Angrenzend: Grundstücke mit gemeinsamer Grenze in dieser Datei."
)

ROW_MM = 6.2
HEADER_MM = 17.0
#: A whole cadastral community holds thousands of parcels; past this the list says how many it left out.
MAX_PAGES = 120

#: Column left edges as fractions of the table width, and whether the column is right-aligned.
_COLUMNS = (
    ("Grundstück", 0.0, False),
    ("KG", 0.17, False),
    ("Kataster", 0.29, False),
    ("Fläche lt. Mappe", 0.62, True),
    ("Angrenzend", 0.66, False),
)
_FAINT = "#d9d6d2"


def table_sheet() -> Sheet:
    """A4 upright, the sheet every list page is set on."""
    width, height = PAPERS_MM["A4"]
    return Sheet("A4", (height, width), None)


def rows_per_page(sheet: Sheet) -> int:
    return max(int((sheet.drawing_area_mm[1] - HEADER_MM) / ROW_MM), 1)


def draw_parcel_pages(parcels: list[Parcel], facts: SheetFacts) -> Iterator[Figure]:
    """One figure per page of the list, at most ``MAX_PAGES`` of them, made as they are asked for."""
    sheet = table_sheet()
    per_page = rows_per_page(sheet)
    chunks = [parcels[start : start + per_page] for start in range(0, len(parcels), per_page)][:MAX_PAGES]
    left_out = len(parcels) - sum(len(chunk) for chunk in chunks)
    for index, chunk in enumerate(chunks):
        figure = Figure(figsize=(sheet.page_mm[0] / 25.4, sheet.page_mm[1] / 25.4))
        last = index == len(chunks) - 1
        _draw_table(figure, sheet, chunk, len(parcels), left_out if last else 0)
        page_facts = replace(
            facts,
            notes=[AREA_NOTE, *facts.notes],
            first_row=[SheetField("Inhalt", "Grundstücke"), SheetField("Blatt", "A4 hoch"), facts.first_row[2]],
            page_label=f"Grundstücke {index + 1} / {len(chunks)}",
            north_up=False,
        )
        draw_sheet(figure, sheet, page_facts)
        yield figure


def _draw_table(figure: Figure, sheet: Sheet, parcels: list[Parcel], total: int, left_out: int) -> None:
    page_w, page_h = sheet.page_mm
    left, _bottom, right, top = sheet.drawing_box_mm
    axes = figure.add_axes((0.0, 0.0, 1.0, 1.0))
    axes.set_axis_off()
    axes.set_xlim(0.0, page_w)
    axes.set_ylim(0.0, page_h)
    pen = SheetPen(axes, house_style())
    width = right - left
    pen.text(left, top - 1.0, "Grundstücke", 14, pen.style.semibold, va="top")
    summary = f"{total} Grundstücke in dieser Datei, aus der Katastralmappe berechnet"
    pen.text(left, top - 7.6, summary, 7, pen.style.regular, va="top", color=INK_MUTED)
    header_y = top - HEADER_MM + 2.0
    for label, at, right_aligned in _COLUMNS:
        align = "right" if right_aligned else "left"
        pen.text(left + width * at, header_y, label, 5.2, pen.style.medium, va="bottom", ha=align, color=INK_MUTED)
    rule_y = header_y - 1.2
    pen.line((left, right), (rule_y, rule_y))
    for row, parcel in enumerate(parcels):
        _row(pen, left, width, rule_y - (row + 0.5) * ROW_MM, parcel)
        line_y = rule_y - (row + 1) * ROW_MM
        axes.plot([left, right], [line_y, line_y], color=_FAINT, lw=0.1 * 72 / 25.4)
    if left_out:
        y = rule_y - (len(parcels) + 0.8) * ROW_MM
        note = f"Weitere {left_out} Grundstücke sind hier nicht aufgeführt."
        pen.text(left, y, note, 7, pen.style.regular, va="center", color=INK_MUTED)


def _row(pen: SheetPen, left: float, width: float, y: float, parcel: Parcel) -> None:
    style = pen.style
    pen.text(left, y, parcel.number, 8.5, style.semibold, va="center")
    pen.text(left + width * 0.17, y, parcel.community or "–", 7.5, style.regular, va="center")
    cadastre = "Grenzkataster" if parcel.boundary_cadastre else "Grundsteuerkataster"
    pen.text(left + width * 0.29, y, cadastre, 7.5, style.regular, va="center")
    area = "nicht geschlossen" if parcel.area_m2 is None else f"{parcel.area_m2:,.0f} m²".replace(",", ".")
    pen.text(left + width * 0.62, y, area, 7.5, style.regular, va="center", ha="right")
    neighbours = ", ".join(parcel.neighbours) or "–"
    capacity = int(width * 0.34 / 1.3)
    if len(neighbours) > capacity:
        neighbours = neighbours[: capacity - 1].rsplit(",", 1)[0] + ", …"
    pen.text(left + width * 0.66, y, neighbours, 7, style.regular, va="center", color=INK_MUTED)
