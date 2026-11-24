from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from ezdxf.document import Drawing
from ezdxf.entities import DXFGraphic

INK = (26, 26, 26)
BUILDING_RED = (192, 57, 43)
LAND_USE_GREEN = (62, 140, 80)
OTHER_BLUE = (43, 87, 151)
BOUNDARY_GREY = (110, 110, 110)

PLOT_STYLE: dict[str, tuple[tuple[int, int, int], int, bool]] = {
    "GG": (INK, 35, False),  # Grundstücksgrenze
    "KG": (BOUNDARY_GREY, 70, True),  # Katastralgemeindegrenze and every rank above
    "PG": (BOUNDARY_GREY, 70, True),
    "BG": (BOUNDARY_GREY, 70, True),
    "VG": (BOUNDARY_GREY, 70, True),
    "LG": (BOUNDARY_GREY, 100, True),
    "RG": (BOUNDARY_GREY, 100, True),
    "HG": (BUILDING_RED, 25, False),  # Gebäude
    "HL": (BOUNDARY_GREY, 18, False),  # Gebäude aus Luftbild
    "NG": (LAND_USE_GREEN, 13, False),  # Nutzungsgrenze
    "NS": (LAND_USE_GREEN, 13, False),
    "VS": (LAND_USE_GREEN, 13, False),
    "RS": (LAND_USE_GREEN, 13, False),
    "SG": (OTHER_BLUE, 18, False),  # Sonstige Linie
    "SS": (OTHER_BLUE, 18, False),
    "SB": (OTHER_BLUE, 18, False),
    "GN": (INK, 18, False),
    "PN": (INK, 18, False),
    "RN": (INK, 18, False),
    "GP": (INK, 18, False),
    "SP": (INK, 18, False),
    "PP": (INK, 18, False),
    "EP": (INK, 18, False),
    "TP": (INK, 18, False),
    "HP": (INK, 18, False),
    "WP": (OTHER_BLUE, 18, False),
}

INK_HEX = "#{:02x}{:02x}{:02x}".format(*INK)


def label_colour(layer: str) -> str:
    colour = PLOT_STYLE.get(layer.upper(), (INK, 0, False))[0]
    return "#{:02x}{:02x}{:02x}".format(*colour)


_DASH_DOT_MM = (6.0, -1.2, 0.0, -1.2)

TEXT_HEIGHT_MM: dict[str, float] = {
    "GN": 2.4,  # parcel numbers
    "PN": 2.2,
    "RN": 2.0,
    "SB": 2.2,  # street and place names
    "GP": 1.3,  # point numbers
    "SP": 1.3,
    "PP": 1.3,
    "EP": 1.3,
    "TP": 1.3,
    "HP": 1.3,
    "WP": 1.3,
}

_SUPPRESSED_TEXT_HEIGHT_M = 0.1

BUILDING_FILL = "#f4dcd7"


@dataclass(frozen=True)
class PointMark:
    x: float
    y: float
    mark: str


def apply_plot_style(doc: Drawing, units_per_mm: float) -> None:
    pattern = [abs(part) * units_per_mm * (1 if part >= 0 else -1) for part in _DASH_DOT_MM]
    if not doc.linetypes.has_entry("CADASTRE_DASHDOT"):
        doc.linetypes.add("CADASTRE_DASHDOT", pattern=[sum(abs(part) for part in pattern), *pattern])
    for name, (colour, lineweight, dash_dot) in PLOT_STYLE.items():
        layer = doc.layers.get(name) if doc.layers.has_entry(name) else doc.layers.add(name)
        layer.rgb = colour
        layer.dxf.lineweight = lineweight
        if dash_dot:
            layer.dxf.linetype = "CADASTRE_DASHDOT"
    sheet_markers = doc.layers.get("RL") if doc.layers.has_entry("RL") else doc.layers.add("RL")
    sheet_markers.off()


def set_label_face(doc: Drawing, face_file: Path | None) -> None:
    if face_file is None:
        return
    for style in doc.styles:
        if style.dxf.name.upper() in {"NORM", "STANDARD"}:
            style.dxf.font = face_file.name


def _texts_on(doc: Drawing) -> Iterator[DXFGraphic]:
    for entity in doc.modelspace():
        if entity.dxftype() == "TEXT":
            yield entity
        elif entity.dxftype() == "INSERT":
            yield from entity.attribs


def size_text_for_paper(doc: Drawing, units_per_mm: float) -> None:
    for text in _texts_on(doc):
        target_mm = TEXT_HEIGHT_MM.get(text.dxf.layer.upper())
        if target_mm is None:
            continue
        if text.dxf.get("height", 1.0) < _SUPPRESSED_TEXT_HEIGHT_M:
            continue  # BEV suppressed this number on purpose
        text.dxf.height = target_mm * units_per_mm


_MARK_BY_BLOCK: dict[str, str] = {
    "FIG020": "cross",
    "FIG220": "cross",
    "FIG024": "stroked",
    "FIG224": "stroked",
    "FIG124": "stroked",
    "FIG025": "circle",
    "FIG225": "circle",
    "FIG011": "triangle",
    "FIG012": "triangle",
    "FIG013": "triangle",
    "FIG014": "circle",
    "FIG017": "circle",
    "FIG018": "circle",
}


def point_marks(doc: Drawing) -> list[PointMark]:
    marks = []
    for insert in doc.modelspace().query("INSERT"):
        mark = _MARK_BY_BLOCK.get(insert.dxf.name.upper())
        if mark is not None:
            marks.append(PointMark(float(insert.dxf.insert[0]), float(insert.dxf.insert[1]), mark))
    return marks


def building_outlines(doc: Drawing) -> list[list[tuple[float, float]]]:
    outlines = []
    for polyline in doc.modelspace().query("POLYLINE LWPOLYLINE"):
        if polyline.dxf.layer.upper() != "HG":
            continue
        if polyline.dxftype() == "POLYLINE":
            points = [(float(v[0]), float(v[1])) for v in polyline.points()]
        else:
            points = [(float(x), float(y)) for x, y in polyline.get_points("xy")]
        closed = polyline.is_closed or (len(points) > 3 and points[0] == points[-1])
        if closed and len(points) >= 3:
            outlines.append(points)
    return outlines
