"""The sheet reader puts everything in one frame: the page as shown, whatever its box and rotation.

PDFium is the oracle for the frame: ``FPDF_PageToDevice`` says where a
user-space point lands on the page as a viewer shows it, and the reader's
segments, characters and stored regions must land there too, on all four
rotations and on a page whose box does not start at zero.
"""

from __future__ import annotations

import ctypes

import pypdfium2 as pdfium
import pytest
from knowledge_layer.sheet import reader
from knowledge_layer.sheet.reader import DASHED
from knowledge_layer.sheet.reader import FILL_EDGE
from knowledge_layer.sheet.reader import SheetTooLarge
from knowledge_layer.sheet.reader import read_characters
from knowledge_layer.sheet.reader import read_sheet
from knowledge_layer.sheet.reader import sheet_format
from knowledge_layer_testing.pdf_fixtures import build_plan_set_pdf
from knowledge_layer_testing.sheet_fixtures import A1_LANDSCAPE
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf
from pypdfium2 import raw

ROTATIONS = (0, 90, 180, 270)
CROPPED = {"media_box": (0.0, 0.0, 400.0, 300.0), "crop_box": (50.0, 20.0, 350.0, 280.0)}


def _oracle(pdf: bytes, x: float, y: float) -> tuple[float, float]:
    """Where PDFium itself puts a user-space point on the shown page, in points from the top left."""
    document = pdfium.PdfDocument(pdf)
    page = document[0]
    width, height = page.get_size()
    device_x, device_y = ctypes.c_int(), ctypes.c_int()
    raw.FPDF_PageToDevice(page, 0, 0, round(width * 100), round(height * 100), 0, x, y, device_x, device_y)
    page.close()
    document.close()
    return device_x.value / 100, device_y.value / 100


def _segment(sheet: dict, index: int) -> tuple[float, float, float, float]:
    return tuple(sheet["segments"]["coords"][4 * index : 4 * index + 4])


@pytest.mark.parametrize("rotate", ROTATIONS)
@pytest.mark.parametrize("boxes", [{}, CROPPED], ids=["origin-zero", "cropped"])
def test_a_line_lands_where_the_viewer_shows_it(rotate, boxes):
    page = SheetPage(rotate=rotate, **boxes)
    page.line(60, 30, 160, 45)
    pdf = build_sheet_pdf([page])

    sheet = read_sheet(pdf, 1)

    assert _segment(sheet, 0) == pytest.approx((*_oracle(pdf, 60, 30), *_oracle(pdf, 160, 45)), abs=0.02)
    # The fixture writer states the same frame a second time; PDFium keeps a box as 32-bit floats.
    assert _segment(sheet, 0) == pytest.approx((*page.shown(60, 30), *page.shown(160, 45)), abs=1e-3)
    assert (sheet["page"]["width_pt"], sheet["page"]["height_pt"]) == pytest.approx(page.shown_size())


@pytest.mark.parametrize("rotate", ROTATIONS)
def test_a_character_lands_where_the_viewer_shows_it(rotate):
    page = SheetPage(rotate=rotate, **CROPPED)
    page.text(200, 100, "7", size=10)
    pdf = build_sheet_pdf([page])

    ((text, origin_x, origin_y, x0, y0, x1, y1, *_),) = read_characters(pdf, 1)["characters"]

    assert text == "7"
    assert (origin_x, origin_y) == pytest.approx(_oracle(pdf, 200, 100), abs=0.02)
    assert x0 <= origin_x <= x1 and y0 <= origin_y <= y1


@pytest.mark.parametrize(("rotate", "expected"), [(0, (1, 0)), (90, (0, 1)), (180, (-1, 0)), (270, (0, -1))])
def test_a_characters_direction_follows_the_page_rotation(rotate, expected):
    page = SheetPage(rotate=rotate)
    page.text(200, 100, "7")

    character = read_characters(build_sheet_pdf([page]), 1)["characters"][0]

    assert character[7:9] == pytest.approx(expected, abs=1e-6)


def test_text_that_advances_upward_reads_upward():
    page = SheetPage()
    page.text(200, 100, "7", angle=90)

    character = read_characters(build_sheet_pdf([page]), 1)["characters"][0]

    # Up on the page is negative y in the shown frame.
    assert character[7:9] == pytest.approx((0, -1), abs=1e-6)


def test_a_bezier_is_its_chord_and_never_a_line_through_a_control_point():
    page = SheetPage()
    page.curve((100, 100), (110, 160), (130, 160), (140, 100))

    sheet = read_sheet(build_sheet_pdf([page]), 1)

    assert len(sheet["segments"]["width"]) == 1
    assert _segment(sheet, 0) == pytest.approx((*page.shown(100, 100), *page.shown(140, 100)))


def test_a_path_point_goes_through_its_objects_matrix_and_so_does_the_stroke_width():
    page = SheetPage()
    page.raw("q 2 0 0 2 10 5 cm 1.5 w 40 40 m 60 40 l S Q")

    sheet = read_sheet(build_sheet_pdf([page]), 1)

    assert _segment(sheet, 0) == pytest.approx((*page.shown(90, 85), *page.shown(130, 85)))
    assert sheet["segments"]["width"][0] == pytest.approx(3.0)


def test_a_path_inside_a_form_goes_through_the_forms_matrix_too():
    page = SheetPage()
    page.form("1 w 10 10 m 30 10 l S", (2.0, 0.0, 0.0, 2.0, 100.0, 50.0))

    sheet = read_sheet(build_sheet_pdf([page]), 1)

    assert _segment(sheet, 0) == pytest.approx((*page.shown(120, 70), *page.shown(160, 70)))
    assert sheet["segments"]["width"][0] == pytest.approx(2.0)


def test_a_closed_rectangle_is_four_segments():
    page = SheetPage()
    page.rect(200, 200, 20, 10)

    assert len(read_sheet(build_sheet_pdf([page]), 1)["segments"]["width"]) == 4


def test_a_segment_carries_its_dash_state_colour_and_whether_it_is_only_a_fill_edge():
    page = SheetPage()
    page.style(width=0.7, dash=(3, 2), rgb=(1, 0, 0))
    page.line(10, 10, 50, 10)
    page.style(width=0.25)
    page.line(10, 20, 50, 20)
    page.rect(100, 100, 30, 30, fill=True)

    segments = read_sheet(build_sheet_pdf([page]), 1)["segments"]

    assert segments["flags"][0] == DASHED and segments["colour"][0] == 0xFF0000
    assert segments["flags"][1] == 0 and segments["width"][1] == pytest.approx(0.25)
    assert segments["flags"][2] == FILL_EDGE and segments["width"][2] == 0.0


@pytest.mark.parametrize("rotate", ROTATIONS)
@pytest.mark.parametrize("boxes", [{}, CROPPED], ids=["origin-zero", "cropped"])
def test_a_stored_region_lands_where_the_viewer_shows_it(rotate, boxes):
    page = SheetPage(rotate=rotate, **boxes)
    page.viewport((60, 30, 300, 250), units_per_point=0.0352778, unit="", ratio="1:100", name="Ground floor")
    pdf = build_sheet_pdf([page])

    (region,) = read_sheet(pdf, 1)["regions"]

    corners = [_oracle(pdf, 60, 30), _oracle(pdf, 300, 250)]
    expected = (
        min(c[0] for c in corners),
        min(c[1] for c in corners),
        max(c[0] for c in corners),
        max(c[1] for c in corners),
    )
    assert region["box"] == pytest.approx(expected, abs=0.02)
    assert region["x"] == [("", pytest.approx(0.0352778))]
    assert (region["subtype"], region["ratio"], region["name"]) == ("RL", "1:100", "Ground floor")
    assert region["y"] is None and region["cyx"] is None


def test_a_stored_regions_y_array_and_cyx_factor_are_reported_not_dropped():
    page = SheetPage()
    page.viewport((0, 0, 100, 100), units_per_point=0.035, y_units_per_point=0.07, cyx=2.0, unit="m")

    (region,) = read_sheet(build_sheet_pdf([page]), 1)["regions"]

    assert region["y"] == [("m", pytest.approx(0.07))]
    assert region["cyx"] == pytest.approx(2.0)


def test_the_user_unit_is_read_and_scales_the_sheet_in_millimetres():
    plain, scaled = SheetPage(), SheetPage(user_unit=2.0)

    first = read_sheet(build_sheet_pdf([plain]), 1)["page"]
    second = read_sheet(build_sheet_pdf([scaled]), 1)["page"]

    assert (first["user_unit"], second["user_unit"]) == (1.0, 2.0)
    assert first["format"] == "A3" and first["width_mm"] == pytest.approx(420, abs=0.1)
    assert second["format"] == "A1" and second["width_mm"] == pytest.approx(840, abs=0.2)


@pytest.mark.parametrize(
    ("size", "name"),
    [
        ((841.0, 594.0), "A1"),
        ((594.0, 841.0), "A1"),
        ((843.5, 592.0), "A1"),
        ((846.0, 594.0), None),
        ((500, 500), None),
    ],
)
def test_the_sheet_format_is_named_within_three_millimetres(size, name):
    assert sheet_format(*size) == name


def test_a_page_of_one_image_and_no_linework_is_a_scan():
    pdf = build_plan_set_pdf(raster_pages=1, rasters_per_page=1, text_pages=0, raster_px=(64, 48))

    sheet = read_sheet(pdf, 1)

    assert sheet["scan"] is True
    assert len(sheet["segments"]["width"]) == 0


def test_a_vector_page_is_not_a_scan():
    page = SheetPage(media_box=(0, 0, *A1_LANDSCAPE))
    page.line(0, 0, 10, 10)

    sheet = read_sheet(build_sheet_pdf([page]), 1)

    assert sheet["scan"] is False and sheet["page"]["format"] == "A1"


def test_a_page_over_the_segment_bound_is_refused_with_the_bound(monkeypatch):
    page = SheetPage()
    for index in range(12):
        page.line(10, 10 + index, 50, 10 + index)
    monkeypatch.setattr(reader, "MAX_SEGMENTS_PER_PAGE", 10)

    with pytest.raises(SheetTooLarge) as refused:
        read_sheet(build_sheet_pdf([page]), 1)

    assert refused.value.segments == 10


def test_reading_characters_walks_no_path(monkeypatch):
    page = SheetPage()
    page.line(10, 10, 50, 10)
    page.text(100, 100, "A")
    monkeypatch.setattr(reader, "_walk", lambda *_: pytest.fail("look reads characters only"))

    assert [c[0] for c in read_characters(build_sheet_pdf([page]), 1)["characters"]] == ["A"]


def test_a_page_the_document_does_not_have_is_a_value_error():
    with pytest.raises(ValueError, match="page 3"):
        read_sheet(build_sheet_pdf([SheetPage()]), 3)


@pytest.mark.parametrize("rotate", ROTATIONS)
@pytest.mark.parametrize("boxes", [{}, CROPPED], ids=["media-only", "cropped"])
def test_boxes_inherited_from_the_page_tree_are_the_frame(rotate, boxes):
    """A page with no box of its own takes the page tree's; PDFium's per-page getters fall back to US Letter."""
    page = SheetPage(rotate=rotate, inherit_boxes=True, **(boxes or {"media_box": (0.0, 0.0, 2384.0, 1684.0)}))
    page.line(100, 100, 300, 200)
    page.text(150, 250, "7")
    pdf = build_sheet_pdf([page])

    sheet = read_sheet(pdf, 1)

    assert _segment(sheet, 0) == pytest.approx((*_oracle(pdf, 100, 100), *_oracle(pdf, 300, 200)), abs=0.02)
    assert sheet["characters"][0][1:3] == pytest.approx(_oracle(pdf, 150, 250), abs=0.02)
    assert (sheet["page"]["width_pt"], sheet["page"]["height_pt"]) == pytest.approx(page.shown_size())


@pytest.mark.parametrize(
    "boxes",
    [
        {"media_box": (800.0, 600.0, 0.0, 0.0)},
        {"media_box": (0.0, 0.0, 800.0, 600.0), "crop_box": (700.0, 500.0, 50.0, 50.0)},
    ],
    ids=["media-reversed", "crop-reversed"],
)
def test_a_box_written_with_its_corners_reversed_is_the_same_box(boxes):
    page = SheetPage(**boxes)
    page.line(100, 100, 300, 200)
    pdf = build_sheet_pdf([page])

    sheet = read_sheet(pdf, 1)

    assert _segment(sheet, 0) == pytest.approx((*_oracle(pdf, 100, 100), *_oracle(pdf, 300, 200)), abs=0.02)
    assert sheet["page"]["width_pt"] > 0 and sheet["page"]["height_pt"] > 0


@pytest.mark.parametrize("angle", [0, 20, 45, 90, 135, 200, 315])
def test_a_characters_advance_is_the_glyphs_own_at_any_angle(angle):
    page = SheetPage()
    page.text(400, 400, "8", size=10, angle=angle)

    character = read_characters(build_sheet_pdf([page]), 1)["characters"][0]

    # Helvetica's digit advances 0.556 of the font size. At 45 degrees the box gives only advance plus height,
    # and with no other text on the page to learn the height from the advance is within a tenth of the size.
    assert character[10] == pytest.approx(5.56, abs=0.8 if angle % 90 == 45 else 0.05)
    assert character[9] == pytest.approx(10.0)
