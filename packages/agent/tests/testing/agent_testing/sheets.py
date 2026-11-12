"""Drawing sheets for the measuring engine's tests: a fixture PDF read into a ``Sheet`` as the tool reads it."""

from __future__ import annotations

from knowledge_layer.sheet.figures import group_figures
from knowledge_layer.sheet.reader import read_sheet
from knowledge_layer_testing.drawing_sheets import FloorSheet
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf

from agent.drawings.sheet_types import Sheet
from agent.drawings.sheet_types import sheet_from_plain


def sheet_of(page: SheetPage) -> Sheet:
    """The page, written as a PDF and read back through the reader and the figure grouping."""
    plain = read_sheet(build_sheet_pdf([page]), 1)
    return sheet_from_plain(plain, group_figures(plain["characters"]))


def floor(**options: object) -> tuple[FloorSheet, Sheet]:
    """A floor drawn at known dimensions and the sheet read from it."""
    drawn = FloorSheet(**options)
    return drawn, sheet_of(drawn.page)
