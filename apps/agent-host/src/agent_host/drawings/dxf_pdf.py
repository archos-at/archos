from __future__ import annotations

import io
import logging
import threading
from collections.abc import Iterable
from datetime import UTC
from datetime import datetime
from pathlib import Path

import matplotlib
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend
from ezdxf.addons.drawing import RenderContext
from ezdxf.addons.drawing import config
from ezdxf.addons.drawing.backend import BackendProperties
from ezdxf.addons.drawing.backend import BkPath2d
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.addons.drawing.matplotlib import to_matplotlib_path
from ezdxf.fonts import fonts
from matplotlib.axes import Axes
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.figure import Figure
from matplotlib.patches import PathPatch
from matplotlib.patches import Polygon

from agent.drawings.dxf_source import DxfSource
from agent.drawings.parcels import read_parcels

from . import cadastre_style
from . import text_layer
from .house_style import house_style
from .parcel_table import draw_parcel_pages
from .sheet import Sheet
from .sheet import choose_sheet
from .sheet import fitted_sheet
from .title_block import SheetFacts
from .title_block import SheetField
from .title_block import draw_sheet

logger = logging.getLogger(__name__)

_PT_PER_MM = 72.0 / 25.4

_RENDER_LOCK = threading.Lock()
_fonts_ready = False

_UNIT_NAMES = {0.001: "Millimeter", 0.01: "Zentimeter", 0.1: "Dezimeter", 1.0: "Meter", 0.0254: "Zoll", 0.3048: "Fuß"}


class EmptyDrawingError(ValueError): ...


def render_pdf(source: DxfSource, *, title: str, source_name: str | None = None) -> bytes:
    with _RENDER_LOCK, matplotlib.rc_context({"pdf.fonttype": 42, "font.family": "DejaVu Sans"}):
        _ensure_fonts()
        extents = _model_extents(source)
        sheet = _sheet_for(source, extents)
        per_mm = _units_per_mm(sheet, extents, source.metres_per_unit)
        if source.cadastre is not None:
            cadastre_style.apply_plot_style(source.doc, per_mm)
            cadastre_style.set_label_face(source.doc, house_style().label_face_file)
            cadastre_style.size_text_for_paper(source.doc, per_mm)
        figure = Figure(figsize=(sheet.page_mm[0] / 25.4, sheet.page_mm[1] / 25.4))
        axes = _drawing_axes(figure, sheet, extents, per_mm)
        _draw_model(source, axes)
        if source.cadastre is not None:
            _draw_cadastre_extras(source, axes)
        texts = text_layer.placed_texts(source)
        if source.cadastre is not None:
            text_layer.write_visible(axes, texts, per_mm, house_style().regular, cadastre_style.label_colour)
        else:
            text_layer.write_transparent(axes, texts, per_mm)
        facts = _sheet_facts(source, sheet, title, source_name or title)
        draw_sheet(figure, sheet, facts)
        buffer = io.BytesIO()
        with PdfPages(buffer, metadata={"Title": title}) as document:
            document.savefig(figure)
            figure.clear()  # the drawing's artists are the bulk of the memory; the list follows
            if source.cadastre is not None:
                for page in draw_parcel_pages(read_parcels(source.doc), facts):
                    document.savefig(page)
                    page.clear()
        return buffer.getvalue()


def _ensure_fonts() -> None:
    global _fonts_ready  # noqa: PLW0603 - a once-per-process cache flag
    if _fonts_ready:
        return
    fonts.font_manager.scan_folder(Path(matplotlib.get_data_path()) / "fonts" / "ttf")
    label_face = house_style().label_face_file
    if label_face is not None:
        fonts.font_manager.scan_folder(label_face.parent)
    _fonts_ready = True


def _model_extents(source: DxfSource) -> bbox.BoundingBox:
    msp = source.doc.modelspace()
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
    if sheet.scale is not None and metres_per_unit is not None:
        return sheet.scale / 1000.0 / metres_per_unit
    area_w, area_h = sheet.drawing_area_mm
    return max(extents.size.x / area_w, extents.size.y / area_h)


def _drawing_axes(figure: Figure, sheet: Sheet, extents: bbox.BoundingBox, per_mm: float) -> Axes:
    page_w, page_h = sheet.page_mm
    left, bottom, right, top = sheet.drawing_box_mm
    axes = figure.add_axes((left / page_w, bottom / page_h, (right - left) / page_w, (top - bottom) / page_h))
    axes.set_axis_off()
    centre = extents.center
    axes.set_xlim(centre.x - (right - left) * per_mm / 2, centre.x + (right - left) * per_mm / 2)
    axes.set_ylim(centre.y - (top - bottom) * per_mm / 2, centre.y + (top - bottom) * per_mm / 2)
    axes.set_aspect("auto")  # the limits already hold one unit per unit both ways
    return axes


class _FixedLimitsBackend(MatplotlibBackend):
    def draw_path(self, path: BkPath2d, properties: BackendProperties) -> None:
        try:
            patch = PathPatch(
                to_matplotlib_path([path]),
                linewidth=self.get_lineweight(properties),
                fill=False,
                color=properties.color,
                zorder=self._get_z(),
            )
        except ValueError:
            return
        self.ax.add_artist(patch)

    def draw_filled_paths(self, paths: Iterable[BkPath2d], properties: BackendProperties) -> None:
        try:
            patch = PathPatch(
                to_matplotlib_path(paths, detect_holes=True),
                color=properties.color,
                linewidth=0,
                fill=True,
                zorder=self._get_z(),
            )
        except ValueError:
            return
        self.ax.add_artist(patch)


def _draw_model(source: DxfSource, axes: Axes) -> None:
    settings = config.Configuration(
        background_policy=config.BackgroundPolicy.WHITE,
        color_policy=config.ColorPolicy.COLOR if source.cadastre else config.ColorPolicy.BLACK,
        lineweight_scaling=_PT_PER_MM,
        min_lineweight=0.13 * _PT_PER_MM,
        text_policy=config.TextPolicy.IGNORE if source.cadastre else config.TextPolicy.FILLING,
    )
    xlim, ylim = axes.get_xlim(), axes.get_ylim()
    backend = _FixedLimitsBackend(axes, adjust_figure=False)
    Frontend(RenderContext(source.doc), backend, config=settings).draw_layout(source.doc.modelspace(), finalize=False)
    axes.set_xlim(*xlim)
    axes.set_ylim(*ylim)


_MARK_STYLE = {
    "cross": ("x", "none", None),
    "triangle": ("^", "white", None),
    "circle": ("o", "white", None),
    "stroked": ("o", "white", "|"),
}


def _draw_cadastre_extras(source: DxfSource, axes: Axes) -> None:
    for outline in cadastre_style.building_outlines(source.doc):
        axes.add_artist(Polygon(outline, closed=True, fc=cadastre_style.BUILDING_FILL, ec="none", zorder=0))
    by_kind: dict[str, list[tuple[float, float]]] = {}
    for mark in cadastre_style.point_marks(source.doc):
        by_kind.setdefault(mark.mark, []).append((mark.x, mark.y))
    style = {
        "markersize": 1.3 * _PT_PER_MM,
        "markeredgewidth": 0.5,
        "color": cadastre_style.INK_HEX,
        "linestyle": "none",
    }
    for kind, points in by_kind.items():
        marker, face, overlay = _MARK_STYLE[kind]
        xs, ys = zip(*points, strict=True)
        axes.plot(xs, ys, marker=marker, markerfacecolor=face, zorder=5, scalex=False, scaley=False, **style)
        if overlay:
            axes.plot(xs, ys, marker=overlay, zorder=5, scalex=False, scaley=False, **style)


def _sheet_facts(source: DxfSource, sheet: Sheet, title: str, source_name: str) -> SheetFacts:
    orientation = "quer" if sheet.page_mm[0] >= sheet.page_mm[1] else "hoch"
    scale_value = f"1:{sheet.scale:,}".replace(",", ".") if sheet.scale else "nicht maßstäblich"
    first_row = [
        SheetField("Maßstab", scale_value),
        SheetField("Blatt", f"{sheet.paper} {orientation}"),
        SheetField("Erstellt", f"{datetime.now(UTC):%d.%m.%Y}"),
    ]
    cadastre = source.cadastre
    if cadastre is not None:
        crs = f"MGI / GK M{cadastre.meridian} · EPSG {cadastre.epsg}" if cadastre.epsg else "nicht angegeben"
        community = ", ".join(cadastre.cadastral_communities) or "–"
        second_row = [SheetField("Koordinaten", crs, span=2), SheetField("Katastralgemeinde", community)]
    else:
        unit = _UNIT_NAMES.get(source.metres_per_unit or 0.0, "nicht angegeben")
        second_row = [SheetField("Einheit der Datei", unit), SheetField("Quelle", "DXF-Datei", span=2)]
    return SheetFacts(
        title=title,
        subtitle=f"Dargestellt aus {source_name}",
        first_row=first_row,
        second_row=second_row,
        notes=_notes(source, sheet),
        scale=sheet.scale,
        unscaled_reason=_unscaled_reason(source),
        north_up=cadastre is not None and cadastre.epsg is not None,
    )


def _unscaled_reason(source: DxfSource) -> str:
    if source.metres_per_unit is None:
        return "Die Datei nennt keine Einheit; die Zeichnung ist auf das Blatt eingepasst."
    return "Zu groß für A0 in einem Normmaßstab; auf das Blatt eingepasst."


def _notes(source: DxfSource, sheet: Sheet) -> list[str]:
    cadastre = source.cadastre
    if cadastre is None:
        notes = ["Monochrom dargestellt, mit den Strichstärken der Datei."]
        if sheet.scale is None:
            notes.insert(0, _unscaled_reason(source))
        return notes
    notes = ["Quelle: Digitale Katastralmappe (BEV), in der Plotdarstellung der Schnittstelle."]
    if cadastre.has_tax_cadastre_parcels:
        notes.insert(
            0,
            "Grundsteuerkataster: Die Grenzen sind graphisch ermittelt und nicht rechtsverbindlich. "
            "Für Abstände zur Grundstücksgrenze ist eine Vermessung maßgeblich.",
        )
    elif cadastre.parcel_numbers:
        notes.insert(0, "Alle Grundstücke im Grenzkataster.")
    notes.append("Grenzpunkte vereinfacht, Nutzungssymbole nicht dargestellt.")
    return notes
