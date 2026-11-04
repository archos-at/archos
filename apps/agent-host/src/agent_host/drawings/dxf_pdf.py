"""A read DXF drawn as a one-page vector PDF at a standard scale (ADR-0152).

ezdxf draws the model space into a matplotlib axes sized to the sheet's drawing
area, and matplotlib writes the PDF. The axes' limits are set from the scale, not
from the drawing, so 20 m at 1:500 is 40 mm on the paper: measured, not assumed,
in ``tests/test_drawing_renditions.py``.

Three things the drawing alone would not give a reader:

* **A text layer.** ezdxf draws text as outlines, so a parcel number on the page
  is a shape, and the viewer's find, the index and a citation's highlight would
  all miss it. Every TEXT, MTEXT and visible ATTRIB is written again as
  transparent text at its own place and height, as a scanner's OCR layer is.
* **A title block.** Scale and sheet, or "not to scale" with the reason; for a
  Katastralmappe the cadastral community, the coordinate system and grid north,
  and, where the file holds Grundsteuerkataster parcels, that their boundaries
  are graphic and not legally binding (BEV's own statement, spec p. 12).
* **A scale bar**, so a print that was scaled anyway can still be measured.

Copy on the page is German: the page is a document for the office, like every
other file a person reads in this product, and its labels are domain text.
"""

from __future__ import annotations

import io
import logging
import threading
from collections.abc import Iterator
from datetime import UTC
from datetime import datetime
from pathlib import Path

import matplotlib
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend
from ezdxf.addons.drawing import RenderContext
from ezdxf.addons.drawing import config
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.fonts import fonts
from ezdxf.math import Vec3
from matplotlib.axes import Axes
from matplotlib.figure import Figure
from matplotlib.patches import Polygon
from matplotlib.patches import Rectangle

from .dxf_source import DxfSource
from .sheet import MARGIN_MM
from .sheet import TITLE_BAND_MM
from .sheet import Sheet
from .sheet import choose_sheet
from .sheet import fitted_sheet
from .sheet import scale_bar_metres

logger = logging.getLogger(__name__)

#: Points per millimetre, for font sizes given as a height on paper.
_PT_PER_MM = 72.0 / 25.4

#: Texts written into the transparent layer at most; a whole cadastral community
#: has tens of thousands of boundary-point numbers nobody searches for.
MAX_TEXT_LAYER_ENTRIES = 20_000

#: matplotlib's rc state and ezdxf's font cache are process-global; one page is
#: drawn at a time. The BFF sends two conversions at once per replica at most.
_RENDER_LOCK = threading.Lock()
_fonts_ready = False


class EmptyDrawingError(ValueError):
    """The model space holds nothing that has extents."""


def render_pdf(source: DxfSource, *, title: str) -> bytes:
    """The drawing as PDF bytes, one page."""
    with _RENDER_LOCK, matplotlib.rc_context({"pdf.fonttype": 42}):
        _ensure_fonts()
        extents = _model_extents(source)
        sheet = _sheet_for(source, extents)
        figure = Figure(figsize=(sheet.page_mm[0] / 25.4, sheet.page_mm[1] / 25.4))
        drawing_axes = _drawing_axes(figure, sheet, extents, source.metres_per_unit)
        _draw_model(source, drawing_axes)
        _write_text_layer(source, drawing_axes, sheet, extents)
        _draw_title_block(figure, sheet, source, title)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="pdf", metadata={"Title": title})
        return buffer.getvalue()


def _ensure_fonts() -> None:
    """Give ezdxf the fonts matplotlib ships, so an image without system fonts still draws text."""
    global _fonts_ready  # noqa: PLW0603 - a once-per-process cache flag
    if _fonts_ready:
        return
    fonts.font_manager.scan_folder(Path(matplotlib.get_data_path()) / "fonts" / "ttf")
    _fonts_ready = True


def _model_extents(source: DxfSource) -> bbox.BoundingBox:
    msp = source.doc.modelspace()
    # A Katastralmappe's sheet markers sit at the sheet's corner, outside what it draws.
    entities = [entity for entity in msp if not (source.cadastre and entity.dxf.layer.upper() == "RL")]
    extents = bbox.extents(entities, fast=True)
    if not extents.has_data or extents.size.x <= 0 or extents.size.y <= 0:
        raise EmptyDrawingError("The drawing has nothing to draw")
    return extents


def _sheet_for(source: DxfSource, extents: bbox.BoundingBox) -> Sheet:
    if source.metres_per_unit is None:
        return fitted_sheet(extents.size.x, extents.size.y)
    return choose_sheet(extents.size.x * source.metres_per_unit, extents.size.y * source.metres_per_unit)


def _units_per_mm(sheet: Sheet, extents: bbox.BoundingBox, metres_per_unit: float | None) -> float:
    """Drawing units one millimetre of paper holds."""
    if sheet.scale is not None and metres_per_unit is not None:
        return sheet.scale / 1000.0 / metres_per_unit
    area_w, area_h = sheet.drawing_area_mm
    return max(extents.size.x / area_w, extents.size.y / area_h)


def _drawing_axes(figure: Figure, sheet: Sheet, extents: bbox.BoundingBox, metres_per_unit: float | None) -> Axes:
    page_w, page_h = sheet.page_mm
    area_w, area_h = sheet.drawing_area_mm
    left, bottom = MARGIN_MM / page_w, (MARGIN_MM + TITLE_BAND_MM) / page_h
    axes = figure.add_axes((left, bottom, area_w / page_w, area_h / page_h))
    axes.set_axis_off()
    per_mm = _units_per_mm(sheet, extents, metres_per_unit)
    centre = extents.center
    axes.set_xlim(centre.x - area_w * per_mm / 2, centre.x + area_w * per_mm / 2)
    axes.set_ylim(centre.y - area_h * per_mm / 2, centre.y + area_h * per_mm / 2)
    axes.set_aspect("auto")  # the limits already hold one unit per unit both ways
    return axes


def _draw_model(source: DxfSource, axes: Axes) -> None:
    settings = config.Configuration(
        background_policy=config.BackgroundPolicy.WHITE,
        # White (colour 7) lines become black on paper; every other colour stays.
        color_policy=config.ColorPolicy.COLOR_SWAP_BW,
    )
    xlim, ylim = axes.get_xlim(), axes.get_ylim()
    backend = MatplotlibBackend(axes, adjust_figure=False)
    Frontend(RenderContext(source.doc), backend, config=settings).draw_layout(source.doc.modelspace(), finalize=False)
    axes.set_xlim(*xlim)
    axes.set_ylim(*ylim)


def _write_text_layer(source: DxfSource, axes: Axes, sheet: Sheet, extents: bbox.BoundingBox) -> None:
    per_mm = _units_per_mm(sheet, extents, source.metres_per_unit)
    written = 0
    for x, y, height, text in _texts(source):
        if written >= MAX_TEXT_LAYER_ENTRIES:
            logger.info("dxf: text layer capped at %d entries", MAX_TEXT_LAYER_ENTRIES)
            return
        size_pt = max(height / per_mm * _PT_PER_MM, 1.0)
        axes.text(x, y, text, alpha=0.0, fontsize=size_pt, clip_on=True)
        written += 1


def _texts(source: DxfSource) -> Iterator[tuple[float, float, float, str]]:
    for entity in source.doc.modelspace():
        kind = entity.dxftype()
        if source.cadastre and entity.dxf.layer.upper() == "RL":
            continue  # sheet markers: a sheet id and dates, not text anyone reads on the page
        if kind == "TEXT":
            yield _placed(entity.dxf.insert, entity.dxf.height, entity.dxf.text)
        elif kind == "MTEXT":
            yield _placed(entity.dxf.insert, entity.dxf.char_height, entity.plain_text())
        elif kind == "INSERT":
            for attrib in entity.attribs:
                if not attrib.is_invisible:
                    yield _placed(attrib.dxf.insert, attrib.dxf.height, attrib.dxf.text)


def _placed(insert: Vec3, height: float, text: str) -> tuple[float, float, float, str]:
    return float(insert[0]), float(insert[1]), float(height or 1.0), " ".join(str(text).split())


def _title_lines(sheet: Sheet, source: DxfSource, title: str) -> list[str]:
    if sheet.scale is not None:
        scale_line = f"Maßstab 1:{sheet.scale} · {sheet.paper}"
    elif source.metres_per_unit is None:
        scale_line = f"Nicht maßstäblich: die Datei nennt keine Einheit · {sheet.paper}"
    else:
        scale_line = f"Nicht maßstäblich: zu groß für A0 · {sheet.paper}"
    lines = [title, scale_line]
    cadastre = source.cadastre
    if cadastre is not None:
        place = (
            f"KG {', '.join(cadastre.cadastral_communities)}" if cadastre.cadastral_communities else "Katastralmappe"
        )
        crs = f"MGI / Österreich GK M{cadastre.meridian} (EPSG {cadastre.epsg}) · Gitternord" if cadastre.epsg else ""
        lines.append(" · ".join(part for part in (place, crs) if part))
        if cadastre.has_tax_cadastre_parcels:
            lines.append("Grundsteuerkataster: Grenzen graphisch ermittelt, nicht rechtsverbindlich")
    lines.append(f"Aus der DXF-Datei dargestellt am {datetime.now(UTC):%d.%m.%Y}")
    return lines


def _draw_title_block(figure: Figure, sheet: Sheet, source: DxfSource, title: str) -> None:
    page_w, page_h = sheet.page_mm
    band = figure.add_axes((0.0, 0.0, 1.0, (MARGIN_MM + TITLE_BAND_MM) / page_h))
    band.set_axis_off()
    band.set_xlim(0.0, page_w)
    band.set_ylim(0.0, MARGIN_MM + TITLE_BAND_MM)
    lines = _title_lines(sheet, source, title)
    for row, line in enumerate(lines):
        weight = "bold" if row == 0 else "normal"
        top = MARGIN_MM + TITLE_BAND_MM - 4.0
        band.text(page_w - MARGIN_MM, top - row * 3.8, line, ha="right", va="top", fontsize=7.5, weight=weight)
    if sheet.scale is not None and source.metres_per_unit is not None:
        _draw_scale_bar(band, sheet.scale, x_mm=MARGIN_MM, y_mm=MARGIN_MM + 6.0)
    if source.cadastre is not None and source.cadastre.epsg is not None:
        _draw_north_arrow(band, x_mm=MARGIN_MM + 75.0, y_mm=MARGIN_MM + 3.0)


def _draw_scale_bar(band: Axes, scale: int, *, x_mm: float, y_mm: float) -> None:
    metres = scale_bar_metres(scale)
    length_mm = metres * 1000.0 / scale
    step = length_mm / 4
    for index in range(4):
        face = "black" if index % 2 == 0 else "white"
        band.add_patch(Rectangle((x_mm + index * step, y_mm), step, 1.6, facecolor=face, edgecolor="black", lw=0.3))
    for index, label in ((0, "0"), (4, _metres_label(metres))):
        band.text(x_mm + index * step, y_mm + 2.8, label, ha="center", va="bottom", fontsize=6.5)


def _metres_label(metres: float) -> str:
    return f"{metres:g} m".replace(".", ",")


def _draw_north_arrow(band: Axes, *, x_mm: float, y_mm: float) -> None:
    band.add_patch(Polygon([(x_mm - 2.5, y_mm), (x_mm, y_mm + 10.0), (x_mm + 2.5, y_mm)], closed=True, color="black"))
    band.text(x_mm, y_mm + 11.0, "N", ha="center", va="bottom", fontsize=7.5, weight="bold")
