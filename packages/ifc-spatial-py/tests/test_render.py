from __future__ import annotations

import io
from pathlib import Path

import pytest
from ifc_spatial import render
from ifc_spatial.model import SpatialModel

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_SPACES = FIXTURES / "units-feet.ifc"

WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
INTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWax"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(HOUSE))


@pytest.fixture(scope="module")
def drawn(house: SpatialModel):
    return render.plan(house)


def _open(png: bytes):
    from PIL import Image

    return Image.open(io.BytesIO(png))


def _red_pixels(png: bytes) -> int:
    image = _open(png).convert("RGB")
    raw = image.tobytes()
    return sum(1 for i in range(0, len(raw), 3) if raw[i] > 180 and raw[i + 1] < 90)


def test_it_is_a_real_png_a_model_could_be_handed(drawn) -> None:
    assert drawn is not None
    assert drawn.png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(drawn.png) > 4_000

    image = _open(drawn.png)
    assert image.size == (drawn.width, drawn.height)
    assert image.mode == "RGB"


def test_the_caption_facts_are_true_of_the_image(drawn) -> None:
    assert drawn.storey == "Ground Floor"
    assert drawn.cut_z == pytest.approx(0.0 + render.CUT_ABOVE_STOREY)
    assert drawn.scale_px_per_m > 0
    assert drawn.drawn > 0
    assert sorted(drawn.rooms) == ["Bedroom", "Entrance hall", "Living room"]
    assert drawn.north_deg is not None


def test_the_cut_passes_through_the_openings(house: SpatialModel) -> None:
    geometry = house.geometry(WINDOW)
    segments = render._segments_at_z(geometry.triangles, render.CUT_ABOVE_STOREY)
    assert segments, "the cut misses the window entirely — openings will not show"

    assert not render._segments_at_z(geometry.triangles, 9.0)


def test_highlighting_changes_the_picture(house: SpatialModel, drawn) -> None:
    marked = render.plan(house, highlight=[WINDOW])
    assert marked is not None
    assert marked.highlighted == [WINDOW]
    assert marked.png != drawn.png

    red = _red_pixels(marked.png)
    assert red > 200, "the highlight is not visibly on the page"
    assert _red_pixels(drawn.png) == 0


def test_two_highlights_both_land(house: SpatialModel) -> None:
    both = render.plan(house, highlight=[WINDOW, INTERNAL_DOOR])
    assert both is not None
    assert both.highlighted == sorted([WINDOW, INTERNAL_DOOR])
    one = render.plan(house, highlight=[WINDOW])
    red_both = _red_pixels(both.png)
    red_one = _red_pixels(one.png)
    assert red_both > red_one


def test_only_isolates_rather_than_marking(house: SpatialModel, drawn) -> None:
    isolated = render.plan(house, only=[WINDOW, INTERNAL_DOOR])
    assert isolated is not None
    assert isolated.drawn < drawn.drawn
    assert isolated.rooms == []


def test_a_label_never_leaves_the_canvas(house: SpatialModel) -> None:
    marked = render.plan(house, highlight=[WINDOW], width_px=700)
    assert marked is not None
    assert marked.width == 700
    image = _open(marked.png)
    assert image.size[0] == 700


def test_a_storey_with_nothing_drawable_is_none_not_a_blank_page(house: SpatialModel) -> None:
    assert render.plan(house, storey="Kein solches Geschoß") is None
    empty = SpatialModel(str(NO_SPACES))
    assert render.plan(empty, only=["nicht-vorhanden"]) is None


def test_a_shortened_label_keeps_the_end_not_the_start() -> None:
    assert render._shorten("Windows_Sgl_Plain:1810x1210mm:286105", 20).endswith("1210mm:286105")
    assert render._shorten("kurz") == "kurz"


def test_north_is_declared_or_absent_never_invented(house: SpatialModel) -> None:
    assert render._true_north_degrees(house) is not None
    assert render._true_north_degrees(SpatialModel(str(FIXTURES / "house-with-rooms.ifc"))) is None


def test_only_may_not_pull_an_element_out_of_another_storey(house: SpatialModel) -> None:
    loft = "09J5N7xMHBfQZeQGAEMota"
    assert house.storey_of(house.file.by_guid(loft)).Name == "Roof"

    assert render.plan(house, storey="Ground Floor", only=[loft]) is None
    assert render.plan(house, storey="Roof", only=["3w0zWKm7n8SB1qbfwUzt0J"]) is None

    own = render.plan(house, storey="Roof", only=[loft])
    assert own is not None
    assert own.rooms == ["Roof"]
    assert own.cut_z == pytest.approx(2.5 + render.CUT_ABOVE_STOREY)
