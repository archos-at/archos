"""How a Katastralmappe looks on paper, from BEV's own plot scheme (ADR-0152).

A Katastralmappe DXF carries no plot styling of its own: the "BEV-DXF+CSV"
variant has no layer table at all, so every line comes out the same white
hairline, and the variant with a header carries the SCREEN colours. BEV's spec
lists a plot colour for every layer (Schnittstellenbeschreibung v2.6, §6,
column "Plot"): parcel boundaries black, buildings red, land-use lines green,
other lines and labels blue, administrative boundaries grey. This module applies
that scheme, with line weights an office would plot it at, and three things the
DXF leaves to the receiving system:

* **Text sized for the paper.** The DKM's text heights are set for the sheet's
  original scale (§4, "Maßstabsabhängige Objekte"), so a 1:2000 sheet printed at
  1:200 has parcel numbers ten times too large. Heights are reset to a size in
  millimetres on the paper; a point number BEV suppressed (height 0.01 × the
  scale factor, §3.8) stays suppressed.
* **Boundary-point marks.** The symbols are INSERTs of BEV blocks the partial
  file does not define. They are drawn here as the spec describes them (§9.2):
  an oblique cross for an unmarked point, a circle with a vertical stroke for a
  marked one, a circle for an indirectly marked one; fixed points as a
  triangle. Land-use symbols are not drawn.
* **Buildings filled.** A building's outline (layer HG) is closed by repeating
  its first vertex (§3.6); it gets the light red fill the analogue map had.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from ezdxf.document import Drawing
from ezdxf.entities import DXFGraphic

#: The colours of BEV's plot column (black, red, green, blue, grey), as print
#: colours: the plot column names ACI 1, 3 and 5, which are the screen's pure
#: #ff0000, #00ff00 and #0000ff and read as a CAD screen, not a plotted sheet.
INK = (26, 26, 26)
BUILDING_RED = (192, 57, 43)
LAND_USE_GREEN = (62, 140, 80)
OTHER_BLUE = (43, 87, 151)
BOUNDARY_GREY = (110, 110, 110)

#: Colour, line weight (1/100 mm) and whether dash-dotted, per layer, after BEV's plot column.
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
    """The plot colour a label on this layer is set in."""
    colour = PLOT_STYLE.get(layer.upper(), (INK, 0, False))[0]
    return "#{:02x}{:02x}{:02x}".format(*colour)


#: The administrative boundaries' dash-dot, in millimetres on paper: dash, gap, dot, gap.
_DASH_DOT_MM = (6.0, -1.2, 0.0, -1.2)

#: Text height on paper, in millimetres, by layer. Anything else keeps its own.
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

#: Below this a point number's height is BEV's "suppressed" marker, in metres.
_SUPPRESSED_TEXT_HEIGHT_M = 0.1

#: Light red of the analogue map's buildings.
BUILDING_FILL = "#f4dcd7"


@dataclass(frozen=True)
class PointMark:
    """A boundary or fixed point to mark: where, and which mark."""

    x: float
    y: float
    #: ``cross`` (unmarked), ``stroked`` (marked), ``circle`` (indirectly marked), ``triangle`` (fixed point).
    mark: str


def apply_plot_style(doc: Drawing, units_per_mm: float) -> None:
    """Give every cadastre layer its plot colour, weight and line type, and hide the sheet markers.

    The dash-dot is defined in drawing units, so it is scaled from its paper size here.
    """
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
    """Set the Katastralmappe's text style (``NORM``, spec §1.1) in the sheet's text face, when there is one."""
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
    """Reset each cadastre text to its paper height at this sheet's scale."""
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
    """The boundary and fixed points the file places, as marks to draw."""
    marks = []
    for insert in doc.modelspace().query("INSERT"):
        mark = _MARK_BY_BLOCK.get(insert.dxf.name.upper())
        if mark is not None:
            marks.append(PointMark(float(insert.dxf.insert[0]), float(insert.dxf.insert[1]), mark))
    return marks


def building_outlines(doc: Drawing) -> list[list[tuple[float, float]]]:
    """Each closed building outline on layer HG, as its vertices."""
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
