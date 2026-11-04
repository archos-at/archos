"""DXF drawn as its PDF rendition (ADR-0152): kept, placed to scale, searchable, refused when it must be."""

from __future__ import annotations

import io

import ezdxf
import pypdfium2
import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_host.drawings.dxf_pdf import render_pdf
from agent_host.drawings.dxf_source import read_dxf
from agent_host.drawings.sheet import choose_sheet
from agent_host.drawings.sheet import scale_bar_metres
from agent_host.routes.drawing_renditions import DXF_RENDITION_PATH
from agent_host.routes.drawing_renditions import add_drawing_rendition_routes
from agent_host.routes.drawing_renditions import page_title

TOKEN = "real-secret"  # pragma: allowlist secret

#: A point in Mödling, Lower Austria, in MGI / Austria GK East (EPSG 31256) with
#: the 5,000,000 of the northing dropped, as BEV writes it.
X0, Y0 = -3139.84, 327390.65


def _bev_partial_dxf() -> bytes:
    """A Katastralmappe shaped like BEV's "BEV-DXF+CSV": R12 minimal header, entities only, no blocks.

    Three parcels and a street parcel; boundaries run node to node and are never
    closed (spec §3.2); the parcel numbers are INSERTs of blocks the file does
    not define (§1, §3.3); the sheet marker names meridian strip 34 (§3.1).
    """
    out = [
        "0",
        "SECTION",
        "2",
        "HEADER",
        "9",
        "$ACADVER",
        "1",
        "AC1009",
        "0",
        "ENDSEC",
        "0",
        "SECTION",
        "2",
        "ENTITIES",
    ]

    def at(dx: float, dy: float) -> tuple[float, float]:
        return X0 + dx, Y0 + dy

    def polyline(layer: str, points: list[tuple[float, float]]) -> None:
        out.extend(["0", "POLYLINE", "8", layer, "66", "1", "10", "0", "20", "0", "30", "0"])
        for x, y in points:
            out.extend(["0", "VERTEX", "8", layer, "10", f"{x:.2f}", "20", f"{y:.2f}", "30", "0"])
        out.extend(["0", "SEQEND", "8", layer])

    def insert(layer: str, block: str, point: tuple[float, float], value: str, tag: str) -> None:
        x, y = point
        out.extend(["0", "INSERT", "8", layer, "66", "1", "2", block, "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0"])
        out.extend(["0", "ATTRIB", "8", layer, "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0", "40", "1.5"])
        out.extend(["1", value, "2", tag, "70", "0", "0", "SEQEND", "8", layer])

    nodes = {"a": (0, 0), "b": (20, 0), "c": (35, 0), "d": (55, 0), "e": (0, 40), "f": (20, 40), "g": (35, 40)}
    nodes |= {"h": (55, 40), "s1": (0, -8), "s2": (55, -8)}
    edges = ["ab", "bc", "cd", "ef", "fg", "gh", "ae", "bf", "cg", "dh"]
    for start, end in [(edge[0], edge[1]) for edge in edges] + [("a", "s1"), ("s1", "s2"), ("s2", "d")]:
        polyline("GG", [at(*nodes[start]), at(*nodes[end])])
    insert("GN", "GN1", at(10, 30), "123/4", "16117")
    insert("GN", "GN1G", at(27, 20), "123/5", "16117")
    insert("GN", "GN1", at(45, 20), "124", "16117")
    insert("GN", "GN1", at(27, -4), ".57", "16117")
    insert("RL", "MBNR", at(-60, -60), "7856F103", "1*34*12*345*1123")
    x, y = at(5, -6)
    out.extend(
        ["0", "TEXT", "8", "SB", "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0", "40", "1.5", "1", "Wiener Straße"]
    )
    out.extend(["0", "ENDSEC", "0", "EOF"])
    return ("\n".join(out) + "\n").encode("cp1252")


def _generic_dxf(insunits: int | None, width: float, height: float) -> bytes:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 0 if insunits is None else insunits  # ezdxf's own default is metres
    doc.modelspace().add_lwpolyline([(0, 0), (width, 0), (width, height), (0, height)], close=True)
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def _page(pdf: bytes) -> pypdfium2.PdfPage:
    return pypdfium2.PdfDocument(pdf)[0]


def _text(pdf: bytes) -> str:
    return _page(pdf).get_textpage().get_text_range()


def _left_mm(pdf: bytes, needle: str) -> float:
    textpage = _page(pdf).get_textpage()
    full = textpage.get_text_range()
    index = full.index(needle)
    left, _bottom, _right, _top = textpage.get_charbox(index)
    return left / 72 * 25.4


def test_a_header_less_bev_file_keeps_every_parcel_number():
    """ezdxf's audit deletes an INSERT whose block is missing; the reader defines a stand-in first."""
    source = read_dxf(_bev_partial_dxf())
    numbers = [insert.attribs[0].dxf.text for insert in source.doc.modelspace().query("INSERT[layer=='GN']")]
    assert numbers == ["123/4", "123/5", "124", ".57"]
    assert set(source.standin_blocks) == {"GN1", "GN1G", "MBNR"}
    assert source.doc.audit().has_fixes is False


def test_a_katastralmappe_says_where_it_is_and_what_it_is_worth():
    cadastre = read_dxf(_bev_partial_dxf()).cadastre
    assert cadastre is not None
    assert (cadastre.meridian, cadastre.epsg) == (34, 31256)
    assert cadastre.cadastral_communities == ("16117",)
    assert cadastre.parcel_numbers == ("123/4", "123/5", "124", ".57")
    assert cadastre.has_tax_cadastre_parcels is True


def test_the_page_is_to_scale_measured_on_the_pdf():
    """123/4 and 124 are numbered 35 m apart; at 1:200 that is 175 mm on the paper."""
    pdf = render_pdf(read_dxf(_bev_partial_dxf()), title="Katasterauszug")
    width, height = _page(pdf).get_size()
    assert (round(width / 72 * 25.4), round(height / 72 * 25.4)) == (420, 297)
    assert "Maßstab 1:200 · A3" in _text(pdf)
    assert _left_mm(pdf, "124") - _left_mm(pdf, "123/4") == pytest.approx(175.0, abs=1.0)


def test_the_page_carries_the_drawing_text_and_the_cadastre_warning():
    text = _text(render_pdf(read_dxf(_bev_partial_dxf()), title="Katasterauszug"))
    for expected in ("123/4", "123/5", ".57", "Wiener Straße", "KG 16117", "EPSG 31256"):
        assert expected in text
    assert "Grundsteuerkataster: Grenzen graphisch ermittelt, nicht rechtsverbindlich" in text
    assert "7856F103" not in text  # the sheet marker is not page text


def test_a_drawing_in_millimetres_is_scaled_from_its_unit():
    pdf = render_pdf(read_dxf(_generic_dxf(4, 20_000, 15_000)), title="Grundriss")
    assert "Maßstab 1:100 · A4" in _text(pdf)
    assert "Gitternord" not in _text(pdf)


def test_a_drawing_that_names_no_unit_says_it_is_not_to_scale():
    text = _text(render_pdf(read_dxf(_generic_dxf(None, 20_000, 15_000)), title="Skizze"))
    assert "Nicht maßstäblich: die Datei nennt keine Einheit" in text
    assert "Maßstab 1:" not in text


@pytest.mark.parametrize(
    ("width_m", "height_m", "paper", "scale"),
    [
        (150, 100, "A3", 500),  # a Kataster extract
        (40, 30, "A4", 200),  # one parcel
        (20, 15, "A4", 100),  # a floor
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
    assert client.post(DXF_RENDITION_PATH, content=_bev_partial_dxf()).status_code == 403


def test_the_route_answers_a_pdf_titled_after_the_original(client: TestClient):
    response = client.post(
        DXF_RENDITION_PATH,
        content=_bev_partial_dxf(),
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
    assert page_title(None) == "DXF-Datei"
