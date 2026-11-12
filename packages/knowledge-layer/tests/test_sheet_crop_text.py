"""What ``look`` is told was printed inside its crop: whole figures, bounded, and the sheet's size."""

from __future__ import annotations

import pytest
from knowledge_layer.sheet import crop_text as module
from knowledge_layer.sheet.crop_text import read_crop_text
from knowledge_layer.view_region import region_box_pt
from knowledge_layer_testing.sheet_fixtures import A1_LANDSCAPE
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf


def _sheet() -> tuple[SheetPage, bytes]:
    page = SheetPage(media_box=(0, 0, *A1_LANDSCAPE))
    page.text(1000, 800, "2,38", size=10)
    page.text(1020, 804, "5", size=6)
    page.text(1400, 800, "Wohnen 23,45 m2", size=10)
    page.text(200, 100, "M 1:100", size=14)
    return page, build_sheet_pdf([page])


def _box(page: SheetPage, x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float]:
    """A box around two user-space corners, as ``(left, top, width, height)`` on the shown page."""
    (ax, ay), (bx, by) = page.shown(x0, y0), page.shown(x1, y1)
    return min(ax, bx), min(ay, by), abs(bx - ax), abs(by - ay)


def test_a_whole_page_lists_every_figure_with_its_place_and_names_the_sheet():
    page, pdf = _sheet()

    text = read_crop_text(pdf, 1)

    assert "841 x 594 mm (A1)" in text.head and "on this page" in text.head
    x, y = page.shown_share(1010, 804)
    assert f"2,38⁵ | x={x:.3f} y={y:.3f}" in text.lines
    assert len(text.lines) == 3


def test_only_figures_whose_centre_is_inside_the_box_are_returned():
    page, pdf = _sheet()

    text = read_crop_text(pdf, 1, _box(page, 950, 780, 1100, 830))

    assert [line.split(" | ")[0] for line in text.lines] == ["2,38⁵"]
    assert "inside this box" in text.head


def test_a_figure_straddling_the_edge_is_left_out_whole_never_cut():
    page, pdf = _sheet()
    # The box ends inside "Wohnen 23,45 m2", left of its centre: its first letters are in, its centre is out.
    text = read_crop_text(pdf, 1, _box(page, 950, 780, 1420, 830))

    assert [line.split(" | ")[0] for line in text.lines] == ["2,38⁵"]
    assert not any("Wohn" in line for line in text.lines)


def test_a_box_without_text_says_so():
    page, pdf = _sheet()

    text = read_crop_text(pdf, 1, _box(page, 10, 1500, 60, 1600))

    assert text.lines == () and "No printed text has its centre inside this box" in text.head


def test_a_page_with_no_characters_says_it_has_no_text_layer():
    page = SheetPage()
    page.line(10, 10, 200, 10)

    text = read_crop_text(build_sheet_pdf([page]), 1)

    assert text.lines == () and "no text layer" in text.head


def test_the_list_is_bounded_and_says_it_was_cut_keeping_the_largest_text(monkeypatch):
    page = SheetPage()
    for index in range(30):
        page.text(50 + 30 * (index % 10), 100 + 20 * (index // 10), f"n{index}", size=5)
    page.text(400, 600, "TITLE", size=20)
    monkeypatch.setattr(module, "MAX_FIGURES", 8)

    text = read_crop_text(build_sheet_pdf([page]), 1)

    assert len(text.lines) == 8
    assert "8 of 31 are listed" in text.head
    assert any(line.startswith("TITLE | ") for line in text.lines)


def test_the_character_bound_cuts_too(monkeypatch):
    page = SheetPage()
    for index in range(6):
        page.text(50, 100 + 20 * index, "x" * 40, size=8)
    monkeypatch.setattr(module, "MAX_CHARACTERS", 100)

    text = read_crop_text(build_sheet_pdf([page]), 1)

    assert len(text.lines) == 2 and "2 of 6 are listed" in text.head


def test_the_box_may_be_computed_from_the_page_as_the_renderer_does():
    page, pdf = _sheet()
    x, y = page.shown_share(1010, 804)

    # A box far below the minimum size: the renderer widens it about its centre, and the text follows.
    text = read_crop_text(pdf, 1, lambda w, h: region_box_pt((x, y, 0.0005, 0.0005), w, h))

    assert [line.split(" | ")[0] for line in text.lines] == ["2,38⁵"]


def test_a_file_that_is_no_pdf_returns_nothing_and_never_raises():
    assert read_crop_text(b"not a pdf", 1) is None


@pytest.mark.parametrize("rotate", [90, 270])
def test_a_turned_sheet_is_sized_as_shown(rotate):
    page = SheetPage(media_box=(0, 0, *A1_LANDSCAPE), rotate=rotate)
    page.text(100, 100, "A")

    assert "594 x 841 mm (A1)" in read_crop_text(build_sheet_pdf([page]), 1).head


def test_one_figure_longer_than_the_bound_does_not_drop_the_others(monkeypatch):
    page = SheetPage()
    page.text(50, 600, "X" * 30, size=20)
    page.text(50, 500, "short", size=8)
    monkeypatch.setattr(module, "MAX_CHARACTERS", 20)

    text = read_crop_text(build_sheet_pdf([page]), 1)

    assert [line.split(" | ")[0] for line in text.lines] == ["short"]


def test_the_text_follows_the_box_the_renderer_shows_on_a_page_with_inherited_boxes():
    """The reader once sized such a page as US Letter while the renderer cropped the real sheet."""
    page = SheetPage(media_box=(0.0, 0.0, 2384.0, 1684.0), inherit_boxes=True)
    page.text(500, 300, "9,99", size=10)
    pdf = build_sheet_pdf([page])

    shown = read_crop_text(pdf, 1, lambda w, h: region_box_pt((0.1, 0.7, 0.3, 0.3), w, h))
    elsewhere = read_crop_text(pdf, 1, lambda w, h: region_box_pt((0.7, 0.5, 0.3, 0.3), w, h))

    assert [line.split(" | ")[0] for line in shown.lines] == ["9,99"]
    assert elsewhere.lines == () and "841 x 594 mm (A1)" in shown.head
