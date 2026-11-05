"""A DXF measured as a site (ADR-0153): the numbers checked by hand against the fixture's own geometry.

The fixture (``agent_testing.cadastre``) is a BEV Katastralmappe in a few
parcels. Parcel 123/4 is the 20 × 40 m block at the west end north of the
street parcel 1288; house 1 stands in it from x 4 to 15 and y 8 to 21. Every
figure asserted below follows from those coordinates.
"""

from __future__ import annotations

import io

import ezdxf
import pytest
from agent_testing.cadastre import R12Writer
from agent_testing.cadastre import bev_partial_dxf

from agent.drawings import site_ops
from agent.drawings import site_reading
from agent.drawings.dxf_source import read_dxf
from agent.drawings.site import Site
from agent.drawings.site import build_site
from agent.drawings.site import parcel_key


@pytest.fixture(scope="module")
def site() -> Site:
    return build_site(read_dxf(bev_partial_dxf()))


def _generic(insunits: int) -> Site:
    """A plain drawing: a 10 000 × 6 000 outline on WALLS, a line, a label, in the unit ``insunits`` names (0: none)."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10_000, 0), (10_000, 6_000), (0, 6_000)], close=True, dxfattribs={"layer": "WALLS"})
    msp.add_line((0, 0), (0, 20_000), dxfattribs={"layer": "AXES"})
    msp.add_text("Wohnen 24 m²", dxfattribs={"layer": "ROOMS", "insert": (2_000, 2_000)})
    stream = io.StringIO()
    doc.write(stream)
    return build_site(read_dxf(stream.getvalue().encode("utf-8")), ("walls",))


def test_the_overview_says_what_the_drawing_is(site: Site) -> None:
    text = site_ops.overview(site).text()
    assert "Katastralmappe (BEV), KG 16117" in text
    assert "EPSG 31256" in text
    assert "Parcels: 8 (1 Grenzkataster, 7 Grundsteuerkataster)." in text
    assert "Buildings: 5" in text


def test_a_parcel_is_named_the_way_a_person_writes_it(site: Site) -> None:
    assert parcel_key("Gst. Nr. 123/4") == "123/4"
    assert site.parcel("Gst. 123/4") is site.parcel("123/4")
    assert site.parcel("Grundstück .57") is None


def test_a_parcel_has_its_area_boundaries_and_buildings(site: Site) -> None:
    text = site_ops.parcel(site, "123/4").text()
    assert "area 800.0 m², perimeter 120.00 m, smallest enclosing rectangle 40.00 m × 20.00 m" in text
    assert "Boundary with 123/5: 40.00 m." in text
    assert "Boundary with 1288: 20.00 m." in text
    assert "edge of the extract): 60.00 m" in text
    assert "Building 1 (HG): 143.0 m²" in text
    assert "coverage 17.9% of the parcel" in text


def test_a_graphic_boundary_is_said_with_every_number(site: Site) -> None:
    for answer in (site_ops.parcel(site, "123/4"), site_ops.setbacks(site, "123/4"), site_reading.layers(site)):
        assert answer.lines[0].startswith("Computed from the Katastralmappe as drawn. Grundsteuerkataster")
    assert "surveyed to centimetres" in site_ops.parcels(site, ["123/5"]).lines[0]


def test_each_building_says_how_far_it_stands_from_each_boundary(site: Site) -> None:
    text = site_ops.setbacks(site, "123/4").text()
    assert "Building 1: to 123/5 5.00 m; to 1288 8.00 m; to the extract edge 4.00 m. Nearest boundary 4.00 m." in text


def test_what_remains_buildable_follows_the_setbacks_given(site: Site) -> None:
    answer = site_ops.buildable(
        site, "123/4", setback_m=3, setbacks_by_neighbour={"Gst. 123/5": 4}, coverage_limit=40, density_limit=1.2
    )
    text = answer.text()
    # x 3 … 16 and y 3 … 37: 13 × 34 m.
    assert (
        "Buildable area inside the setbacks: 442.0 m² (55.2% of 800.0 m²); its enclosing rectangle is 34.00 m × 13.00 m"
        in text
    )
    assert "not a building footprint that fits" in text
    assert "Coverage limit 40%: at most 320.0 m² built-up area; existing 143.0 m², 177.0 m² left." in text
    assert "Density limit 1.2: at most 960.0 m² gross floor area." in text
    assert "not read from law or plan" in text


def test_a_coverage_limit_reads_as_a_share_or_a_percentage(site: Site) -> None:
    share = site_ops.buildable(site, "123/4", setback_m=3, coverage_limit=0.4).text()
    percent = site_ops.buildable(site, "123/4", setback_m=3, coverage_limit=40).text()
    assert "at most 320.0 m²" in share
    assert share == percent


def test_distances_between_buildings_and_between_parcels(site: Site) -> None:
    assert "building 1 – building 2: 8.00 m." in site_ops.distance(site, "building 1", "building 2").text()
    assert "123/4 – 125/1: 35.00 m." in site_ops.distance(site, "123/4", "125/1").text()


def test_an_unknown_parcel_is_undecidable_and_names_the_ones_there_are(site: Site) -> None:
    answer = site_ops.parcel(site, "999")
    assert not answer.decidable
    assert "123/4, 123/5" in answer.text()


def test_labels_are_found_with_where_they_stand(site: Site) -> None:
    text = site_reading.texts(site, "STRASSE".lower().replace("ss", "ß"), 10).text()
    assert "'Wiener Straße' · layer SB" in text
    assert "on parcel 1288" in text


def test_layers_say_what_they_hold_and_sum_it(site: Site) -> None:
    text = site_reading.layers(site).text()
    assert "HG: POLYLINE 5 · lines 230.0 m · 5 closed outlines, 650.0 m²" in text


def test_a_drawing_without_a_unit_measures_nothing_in_metres() -> None:
    site = _generic(0)
    assert site.metres_per_unit is None
    answer = site_ops.distance(site, "building 1", "building 1")
    assert not answer.decidable
    assert "$INSUNITS" in answer.text()
    layers = site_reading.layers(site).text()
    assert "not metres" in layers
    assert "drawing units" in layers and " m²" not in layers


def test_a_plain_drawing_in_millimetres_is_converted_and_its_buildings_are_the_layers_named() -> None:
    site = _generic(4)
    assert site.metres_per_unit == pytest.approx(0.001)
    assert [footprint.layer for footprint in site.footprints] == ["WALLS"]
    assert "Computed from the drawing as drawn" in site_reading.layers(site).lines[0]
    layers = site_reading.layers(site).text()
    assert "AXES: LINE 1 · lines 20.0 m" in layers
    assert "WALLS: LWPOLYLINE 1 · lines 32.0 m · 1 closed outlines, 60.0 m²" in layers
    assert "Katastralmappe" not in site_ops.overview(site).text()
    assert not site_ops.parcel(site, "1").decidable


def _two_communities() -> Site:
    """Parcel „12“ in KG 16117 and again in KG 16118 across a KG boundary, and „20“ drawn in two parts."""
    dxf = R12Writer()
    for x in (0, 20, 40):
        dxf.polyline("KG" if x == 20 else "GG", [(x, 0), (x, 20)])
    for a, b in ((0, 20), (20, 40)):
        dxf.polyline("GG", [(a, 0), (b, 0)])
        dxf.polyline("GG", [(a, 20), (b, 20)])
    for x0 in (60, 90):  # two separate meshes, both numbered 20 in KG 16117
        dxf.polyline("GG", [(x0, 0), (x0 + 10, 0), (x0 + 10, 10), (x0, 10), (x0, 0)])
    dxf.insert("GN", "GN1", (10, 10), "12", "16117")
    dxf.insert("GN", "GN1", (30, 10), "12", "16118")
    dxf.insert("GN", "GN1", (65, 5), "20", "16117")
    dxf.insert("GN", "GN1", (95, 5), "20", "16117")
    dxf.insert("RL", "MBNR", (-60, -60), "7856F103", "1*34*12*345*1123", height=1.0, flags=1)
    return build_site(read_dxf(dxf.bytes()))


def test_a_number_in_two_communities_asks_for_the_kg() -> None:
    site = _two_communities()
    answer = site_ops.parcel(site, "12")
    assert not answer.decidable
    assert "'12 KG 16117'" in answer.text() and "'12 KG 16118'" in answer.text()
    east = site_ops.parcel(site, "12 KG 16118").text()
    assert "Parcel 12, KG 16118" in east
    assert "Boundary with 12 (KG 16117): 20.00 m." in east


def test_a_parcel_drawn_in_two_parts_is_one_parcel() -> None:
    text = site_ops.parcel(_two_communities(), "20").text()
    assert "area 200.0 m²" in text


def _l_shaped() -> Site:
    """One L-shaped parcel, 20 × 20 with the 10 × 10 north-east quarter cut out: 300 m²."""
    dxf = R12Writer()
    dxf.polyline("GG", [(0, 0), (20, 0), (20, 10), (10, 10), (10, 20), (0, 20), (0, 0)])
    dxf.insert("GN", "GN1", (5, 5), "7", "16117")
    dxf.insert("RL", "MBNR", (-60, -60), "7856F103", "1*34*12*345*1123", height=1.0, flags=1)
    return build_site(read_dxf(dxf.bytes()))


def test_a_setback_band_covers_the_re_entrant_corner() -> None:
    """Every point within 3 m of the boundary is outside what remains, the quarter circle at the inner corner too."""
    from shapely.geometry import Polygon

    site = _l_shaped()
    parcel = site.parcel("7")
    exact = parcel.polygon.difference(parcel.polygon.exterior.buffer(3 / site.metres_per_unit))
    text = site_ops.buildable(site, "7", setback_m=3).text()
    assert f"{exact.area:,.1f} m²".replace(",", " ") in text
    assert isinstance(parcel.polygon, Polygon)


def test_a_drawing_in_feet_names_its_unit() -> None:
    site = _generic(2)
    assert site.metres_per_unit == pytest.approx(0.3048)
    assert "unit feet" in site_ops.overview(site).text()
    assert "unit not stated" in site_ops.overview(_generic(0)).text()


def test_naming_a_parcel_the_file_lacks_says_so() -> None:
    text = site_ops.parcels(build_site(read_dxf(bev_partial_dxf())), ["123/4", "999"]).text()
    assert "Not in this file: 999." in text
    assert "more not listed" not in text
