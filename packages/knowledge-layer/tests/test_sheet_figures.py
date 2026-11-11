"""Characters become figures: whole, in reading order, on any rotation and at any angle."""

from __future__ import annotations

import math

import pytest
from knowledge_layer.sheet.figures import group_figures
from knowledge_layer.sheet.reader import read_characters
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf
from knowledge_layer_testing.sheet_fixtures import dimension

ROTATIONS = (0, 90, 180, 270)
CROPPED = {"media_box": (0.0, 0.0, 400.0, 300.0), "crop_box": (50.0, 20.0, 350.0, 280.0)}
PRINTED = ["2,00", "185", "2,38⁵", "Zimmer 14,20 m2", "M 1:100", "+3,25"]


def _figures(page: SheetPage) -> list[dict]:
    return group_figures(read_characters(build_sheet_pdf([page]), 1)["characters"])


def _drawn(rotate: int = 0, **boxes) -> SheetPage:
    page = SheetPage(rotate=rotate, **boxes)
    dimension(page, (100, 250), (300, 250), "2,00")
    # Written back to front, one character at a time, as some plots write a rotated figure.
    page.text_in_file_order([(100, 211.1, "5"), (100, 205.6, "8"), (100, 200, "1")], size=10, angle=90)
    page.text(200, 100, "2,38", size=10)
    page.text(220, 104, "5", size=6)
    page.text(200, 60, "Zimmer 14,20 m2", size=8)
    page.text(250, 40, "M 1:100", size=12)
    page.text(120, 150, "+3,25", size=7, angle=20)
    return page


@pytest.mark.parametrize("rotate", ROTATIONS)
@pytest.mark.parametrize("boxes", [{}, CROPPED], ids=["origin-zero", "cropped"])
def test_every_figure_reads_back_exactly_on_every_rotation(rotate, boxes):
    figures = _figures(_drawn(rotate, **boxes))

    assert sorted(figure["text"] for figure in figures) == sorted(PRINTED)


def test_a_figure_written_back_to_front_reads_185_not_581():
    texts = [figure["text"] for figure in _figures(_drawn())]

    assert "185" in texts and "581" not in texts


def test_a_raised_final_digit_stays_in_its_figure_and_is_named():
    (figure,) = [figure for figure in _figures(_drawn()) if figure["raised"]]

    assert figure["text"] == "2,38⁵" and figure["raised"] == "5"
    assert not any(figure["text"] == "5" for figure in _figures(_drawn()))


@pytest.mark.parametrize("rotate", ROTATIONS)
def test_a_figures_place_and_angle_are_those_of_the_page_as_shown(rotate):
    page = _drawn(rotate, **CROPPED)

    by_text = {figure["text"]: figure for figure in _figures(page)}

    # "M 1:100" starts at (250, 40) in user space and is about 42 pt long at 12 pt.
    centre = page.shown(250 + 21, 40 + 4)
    assert by_text["M 1:100"]["centre"] == pytest.approx(centre, abs=4.0)
    assert by_text["M 1:100"]["angle"] == (360 - rotate) % 360
    assert by_text["185"]["angle"] == (90 - rotate) % 360
    assert by_text["+3,25"]["angle"] == (20 - rotate) % 360
    assert by_text["M 1:100"]["height"] == pytest.approx(12.0)


def test_figures_along_one_dimension_chain_stay_apart():
    page = SheetPage()
    for index, label in enumerate(["1,20", "3,45", "0,80"]):
        dimension(page, (100 + 80 * index, 200), (180 + 80 * index, 200), label)

    assert [figure["text"] for figure in _figures(page)] == ["1,20", "3,45", "0,80"]


def test_two_lines_of_a_room_stamp_are_two_figures_top_first():
    page = SheetPage()
    page.text(100, 200, "Wohnen", size=9)
    page.text(100, 188, "23,45 m2", size=9)

    assert [figure["text"] for figure in _figures(page)] == ["Wohnen", "23,45 m2"]


def test_a_view_drawn_at_twenty_degrees_reads_along_its_own_axis():
    page = SheetPage()
    angle = math.radians(20)
    end = (100 + 150 * math.cos(angle), 100 + 150 * math.sin(angle))
    dimension(page, (100, 100), end, "5,25")

    (figure,) = _figures(page)

    assert figure["text"] == "5,25" and figure["angle"] == 20
    assert figure["direction"] == pytest.approx((math.cos(angle), -math.sin(angle)), abs=1e-3)


def test_a_small_digit_that_is_not_raised_is_its_own_figure():
    page = SheetPage()
    page.text(200, 100, "2,38", size=10)
    page.text(220, 100, "5", size=6)

    assert sorted(figure["text"] for figure in _figures(page)) == ["2,38", "5"]


def test_no_characters_no_figures():
    assert group_figures([]) == []


OBLIQUE = [10, 20, 45, 70, 135, 200, 315]


def _at(angle: float, along: float, up: float, origin=(500.0, 400.0)) -> tuple[float, float]:
    """A place ``along`` the baseline and ``up`` from it, for text written at ``angle`` from ``origin``."""
    cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return origin[0] + along * cos - up * sin, origin[1] + along * sin + up * cos


@pytest.mark.parametrize("angle", [0, 90, *OBLIQUE])
def test_spaces_and_a_raised_digit_read_the_same_at_every_angle(angle):
    page = SheetPage()
    page.text(*_at(angle, 0, 0), "12,50 m", size=8, angle=angle)
    page.text(*_at(angle, 0, 60), "2,38", size=8, angle=angle)
    page.text(*_at(angle, 16.2, 63.2), "5", size=5, angle=angle)

    assert sorted(figure["text"] for figure in _figures(page)) == ["12,50 m", "2,38⁵"]


@pytest.mark.parametrize("angle", [0, 20, 45, 135])
@pytest.mark.parametrize("apart", [1.2, 2.0])
def test_two_lines_stay_two_figures_at_every_angle(angle, apart):
    page = SheetPage()
    page.text(*_at(angle, 0, 0), "2,385", size=8, angle=angle)
    page.text(*_at(angle, 3, -8 * apart), "1,20", size=8, angle=angle)

    assert sorted(figure["text"] for figure in _figures(page)) == ["1,20", "2,385"]


def test_text_elsewhere_on_the_sheet_never_joins_two_lines_of_a_stamp():
    """Nine baselines stepping down by less than the tolerance, 400 pt away, once chained the two lines into one
    and interleaved their characters („W25o,h3n0emn“)."""
    page = SheetPage()
    page.text(300, 400, "Wohnen", size=8)
    page.text(302, 391, "25,30 m", size=8)
    for step in range(1, 10):
        page.text(700 + step * 40, 400 - step * 0.9, "x", size=8)

    texts = [figure["text"] for figure in _figures(page)]

    assert "Wohnen" in texts and "25,30 m" in texts
    assert texts.count("x") == 9


@pytest.mark.parametrize(
    ("body", "tail", "tail_size", "lift", "expected"),
    [
        ("Raum 1", "2", 5, 3.2, ["2", "Raum 1"]),  # a footnote marker after a word
        ("2,40", "30", 6, 2.0, ["2,40", "30"]),  # a second, smaller figure set a little higher
        ("2,385", "12", 5, 1.6, ["12", "2,385"]),
        ("25,30 m", "2", 5, 3.2, ["2", "25,30 m"]),  # the exponent of a unit
    ],
)
def test_only_one_raised_digit_after_a_number_is_attached(body, tail, tail_size, lift, expected):
    from knowledge_layer_testing.sheet_fixtures import helvetica_width

    page = SheetPage()
    page.text(300, 400, body, size=8)
    page.text(300 + helvetica_width(body, 8) + 0.5, 400 + lift, tail, size=tail_size)

    assert sorted(figure["text"] for figure in _figures(page)) == expected


def test_a_raised_digit_followed_by_a_unit_stays_after_its_number():
    page = SheetPage()
    page.text(300, 400, "2,38", size=8)
    page.text(316.2, 403.2, "5", size=5)
    page.text(321.5, 400, "m", size=8)

    (figure,) = _figures(page)

    assert figure["text"] in ("2,38⁵ m", "2,38⁵m") and figure["raised"] == "5"


@pytest.mark.parametrize("matrix", ["-1 0 0 1 800 0", "1 0 0 -1 0 800"], ids=["mirrored-x", "mirrored-y"])
def test_mirrored_text_keeps_its_raised_digit(matrix):
    page = SheetPage()
    page.raw(f"q {matrix} cm")
    page.text(300, 400, "2,38", size=8)
    page.text(316.2, 403.2, "5", size=5)
    page.raw("Q")

    assert [figure["text"] for figure in _figures(page)] == ["2,38⁵"]
