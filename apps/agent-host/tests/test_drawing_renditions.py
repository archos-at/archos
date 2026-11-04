"""DXF drawn as its PDF rendition (ADR-0152): kept, placed to scale, searchable, refused when it must be."""

from __future__ import annotations

import io
import json
import time
from pathlib import Path

import ezdxf
import pypdfium2
import pytest
from agent_testing.cadastre import PARCELS
from agent_testing.cadastre import R12Writer
from agent_testing.cadastre import bev_partial_dxf
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient
from matplotlib.figure import Figure

from agent.drawings.dxf_source import read_dxf
from agent.drawings.parcels import read_parcels
from agent_host.drawings import cadastre_style
from agent_host.drawings import dxf_pdf
from agent_host.drawings import house_style as house_style_module
from agent_host.drawings.dxf_pdf import render_pdf
from agent_host.drawings.house_style import house_style
from agent_host.drawings.sheet import choose_sheet
from agent_host.drawings.sheet import scale_bar_metres
from agent_host.routes.drawing_renditions import DXF_RENDITION_PATH
from agent_host.routes.drawing_renditions import add_drawing_rendition_routes
from agent_host.routes.drawing_renditions import page_title
from agent_host.routes.drawing_renditions import source_name

TOKEN = "real-secret"  # pragma: allowlist secret


def _dxf_bytes(doc: ezdxf.document.Drawing) -> bytes:
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def _generic_dxf(insunits: int | None, width: float, height: float) -> bytes:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 0 if insunits is None else insunits  # ezdxf's own default is metres
    doc.modelspace().add_lwpolyline([(0, 0), (width, 0), (width, height), (0, height)], close=True)
    return _dxf_bytes(doc)


def _page(pdf: bytes) -> pypdfium2.PdfPage:
    return pypdfium2.PdfDocument(pdf)[0]


def _text(pdf: bytes, page: int = 0) -> str:
    return pypdfium2.PdfDocument(pdf)[page].get_textpage().get_text_range()


def _centre_mm(pdf: bytes, needle: str) -> float:
    """The horizontal centre of a text on the page, from its first and last glyph."""
    textpage = _page(pdf).get_textpage()
    index = textpage.get_text_range().index(needle)
    left = textpage.get_charbox(index)[0]
    right = textpage.get_charbox(index + len(needle) - 1)[2]
    return (left + right) / 2 / 72 * 25.4


def test_a_header_less_bev_file_keeps_every_parcel_number():
    """ezdxf's audit deletes an INSERT whose block is missing; the reader defines a stand-in first."""
    source = read_dxf(bev_partial_dxf())
    numbers = [insert.attribs[0].dxf.text for insert in source.doc.modelspace().query("INSERT[layer=='GN']")]
    assert numbers == [number for number, _at, _boundary in PARCELS]
    assert set(source.standin_blocks) == {"FIG020", "FIG024", "GN1", "GN1G", "MBNR"}
    assert source.doc.audit().has_fixes is False


def test_a_katastralmappe_says_where_it_is_and_what_it_is_worth():
    cadastre = read_dxf(bev_partial_dxf()).cadastre
    assert cadastre is not None
    assert (cadastre.meridian, cadastre.epsg) == (34, 31256)
    assert cadastre.cadastral_communities == ("16117",)
    assert cadastre.parcel_numbers == tuple(number for number, _at, _boundary in PARCELS)
    assert cadastre.has_tax_cadastre_parcels is True


def test_the_page_is_to_scale_measured_on_the_pdf():
    """123/4 and 124 are centred 35 m apart; at 1:500 that is 70 mm on the paper."""
    pdf = render_pdf(read_dxf(bev_partial_dxf()), title="Katasterauszug")
    width, height = _page(pdf).get_size()
    assert (round(width / 72 * 25.4), round(height / 72 * 25.4)) == (210, 297)
    text = _text(pdf)
    assert "1:500" in text
    assert "A4 hoch" in text
    assert _centre_mm(pdf, "124") - _centre_mm(pdf, "123/4") == pytest.approx(70.0, abs=1.0)


def test_parcel_numbers_are_sized_for_the_paper_not_for_the_sheet_they_came_from():
    """At 1:500 one millimetre is half a metre: a parcel number is 2.4 mm, a suppressed point number stays hidden."""
    source = read_dxf(bev_partial_dxf())
    render_pdf(source, title="Katasterauszug")
    heights = {
        insert.dxf.layer: insert.attribs[0].dxf.height
        for insert in source.doc.modelspace().query("INSERT")
        if insert.attribs and insert.dxf.name in {"GN1", "FIG020"}
    }
    assert heights["GN"] == pytest.approx(2.4 * 0.5)
    assert heights["GP"] == pytest.approx(0.01)
    assert source.doc.layers.get("HG").rgb == cadastre_style.BUILDING_RED
    assert source.doc.layers.get("KG").dxf.linetype == "CADASTRE_DASHDOT"


def test_the_page_carries_the_drawing_text_and_the_cadastre_warning():
    text = _text(render_pdf(read_dxf(bev_partial_dxf()), title="Katasterauszug"))
    for expected in ("123/4", "123/5", "1288", "Wiener Straße", "16117", "EPSG 31256", "Gitternord"):
        assert expected in text
    assert "Grundsteuerkataster: Die Grenzen sind graphisch ermittelt und nicht rechtsverbindlich." in text
    assert "7856F103" not in text  # the sheet marker is not page text


def test_the_parcels_are_rebuilt_from_the_boundary_network_with_their_areas_and_neighbours():
    """No parcel is a polygon in a DKM (spec §3.2): 20 × 40 m is 800 m², the street touches every block parcel."""
    parcels = {parcel.number: parcel for parcel in read_parcels(read_dxf(bev_partial_dxf()).doc)}
    assert parcels["123/4"].area_m2 == pytest.approx(800.0)
    assert parcels["123/5"].area_m2 == pytest.approx(600.0)
    assert parcels["123/5"].boundary_cadastre is True
    assert parcels["124"].neighbours == ("123/5", "125/1", "1288")
    assert set(parcels["1288"].neighbours) == {"123/4", "123/5", "124", "125/1", "130", "131/2", "131/3"}
    assert all(parcel.community == "16117" for parcel in parcels.values())


def test_a_parcel_cut_open_at_the_edge_of_an_extract_has_no_area():
    dxf = R12Writer()
    dxf.polyline("GG", [(0, 0), (20, 0), (20, 30)])  # three sides only
    dxf.insert("GN", "GN1", (10, 10), "77/1", "16117")
    dxf.insert("RL", "MBNR", (-60, -60), "7856F103", "1*34*12*345*1123", height=1.0, flags=1)
    [parcel] = read_parcels(read_dxf(dxf.bytes()).doc)
    assert (parcel.number, parcel.area_m2) == ("77/1", None)


def test_the_parcel_list_is_a_page_of_text_the_index_reads():
    """Page 2 lists every parcel, one per line, so "how big is 123/4?" finds its row."""
    pdf = render_pdf(read_dxf(bev_partial_dxf()), title="Katasterauszug")
    assert len(pypdfium2.PdfDocument(pdf)) == 2
    listing = _text(pdf, page=1)
    assert "123/4 16117 Grundsteuerkataster 800 m² 123/5, 1288" in listing
    assert "123/5 16117 Grenzkataster 600 m²" in listing
    assert "nicht das Flächenausmaß des Grundbuchs" in listing


def test_a_drawing_that_is_no_katastralmappe_has_no_parcel_list():
    assert len(pypdfium2.PdfDocument(render_pdf(read_dxf(_generic_dxf(4, 20_000, 15_000)), title="Grundriss"))) == 1


def test_the_sheet_names_its_maker_quietly_from_the_brand_identity():
    """The name comes from the synced identity.json, never typed into the code (ADR-0149)."""
    style = house_style()
    identity = json.loads((Path(house_style_module.__file__).with_name("brand") / "identity.json").read_text("utf-8"))
    assert style.product_name == identity["name"]
    assert style.label_face_file is not None  # the brand type unpacked, not the fallback
    assert f"Erstellt mit {identity['name']}" in _text(render_pdf(read_dxf(bev_partial_dxf()), title="Katasterauszug"))


def test_a_whole_cadastral_community_renders_inside_the_budget():
    """1,600 parcels with houses, numbers and boundary points: well inside the route's 110 s, and small."""
    dxf = R12Writer()
    size, count = 25.0, 40
    for i in range(count + 1):
        for j in range(count):
            dxf.polyline("GG", [(i * size, j * size), (i * size, (j + 1) * size)])
            dxf.polyline("GG", [(j * size, i * size), ((j + 1) * size, i * size)])
    for i in range(count):
        for j in range(count):
            x, y = i * size, j * size
            dxf.polyline("HG", [(x + 5, y + 5), (x + 15, y + 5), (x + 15, y + 14), (x + 5, y + 14), (x + 5, y + 5)])
            dxf.insert("GN", "GN1", (x + 12.5, y + 19), f"{i * count + j + 1}", "16117")
            dxf.insert("GP", "FIG024", (x, y), "", "16117*G**", height=2.5)
    dxf.insert("RL", "MBNR", (-60, -60), "7856F103", "1*34*12*345*1123", height=1.0, flags=1)
    started = time.monotonic()
    pdf = render_pdf(read_dxf(dxf.bytes()), title="KG")
    assert time.monotonic() - started < 60
    assert len(pdf) < 2_000_000


def test_line_weights_plot_as_they_say():
    """ezdxf hands matplotlib millimetres as points; a 0.5 mm line must come out 0.5 mm, not 0.18."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    doc.modelspace().add_line((0, 0), (10, 0), dxfattribs={"lineweight": 50})
    figure = Figure(figsize=(4, 3))
    axes = figure.add_axes((0, 0, 1, 1))
    dxf_pdf._draw_model(read_dxf(_dxf_bytes(doc)), axes)
    widths = [width for collection in axes.collections for width in collection.get_linewidths()]
    widths += [line.get_linewidth() for line in axes.lines]
    assert max(widths) == pytest.approx(0.5 * 72 / 25.4, rel=0.01)


def test_a_drawing_in_millimetres_is_scaled_from_its_unit():
    text = _text(render_pdf(read_dxf(_generic_dxf(4, 20_000, 15_000)), title="Grundriss"))
    assert "1:100" in text
    assert "A3 quer" in text
    assert "Millimeter" in text
    assert "Gitternord" not in text


def test_a_drawing_that_names_no_unit_says_it_is_not_to_scale():
    text = _text(render_pdf(read_dxf(_generic_dxf(None, 20_000, 15_000)), title="Skizze"))
    assert "Nicht maßstäblich" in text
    assert "Die Datei nennt keine Einheit" in text
    assert "M 1:" not in text


@pytest.mark.parametrize(
    ("width_m", "height_m", "paper", "scale"),
    [
        (150, 100, "A3", 500),  # a Kataster extract
        (40, 30, "A3", 200),  # one parcel: too tall for A4 under its title band
        (20, 15, "A3", 100),  # a floor
        (3000, 2000, "A1", 5000),  # too coarse for A3 at 1:2000; detail before a smaller sheet
    ],
)
def test_the_most_detailed_standard_scale_on_the_smallest_sheet(width_m, height_m, paper, scale):
    sheet = choose_sheet(width_m, height_m)
    assert (sheet.paper, sheet.scale) == (paper, scale)


def test_a_drawing_too_large_for_a0_is_fitted_not_scaled():
    assert choose_sheet(80_000, 50_000).scale is None


def test_the_scale_bar_is_a_round_length_of_a_measurable_size():
    for scale in (100, 200, 500, 1000, 2000):
        assert 25 <= scale_bar_metres(scale) * 1000 / scale <= 60


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    router = APIRouter()
    add_drawing_rendition_routes(router)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_the_route_refuses_a_caller_without_the_internal_token(client: TestClient):
    assert client.post(DXF_RENDITION_PATH, content=bev_partial_dxf()).status_code == 403


def test_the_route_answers_a_pdf_titled_after_the_original(client: TestClient):
    response = client.post(
        DXF_RENDITION_PATH,
        content=bev_partial_dxf(),
        headers={"x-internal-token": TOKEN, "x-filename": "Katasterauszug%20M%C3%B6dling.dxf"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "Katasterauszug Mödling" in _text(response.content)


def test_the_route_refuses_bytes_that_are_no_drawing(client: TestClient):
    response = client.post(DXF_RENDITION_PATH, content=b"not a dxf at all", headers={"x-internal-token": TOKEN})
    assert response.status_code == 422


def test_a_title_is_a_name_never_a_path():
    assert page_title("..%2F..%2Fetc%2FLageplan.DXF") == "Lageplan"
    assert page_title("Katasterauszug_KG16117_Gst123-4.dxf") == "Katasterauszug KG16117 Gst123-4"
    assert source_name("..%2Fetc%2FLageplan.dxf") == "Lageplan.dxf"
    assert page_title(None) == "DXF-Datei"
