from __future__ import annotations

import logging
from collections.abc import Callable
from collections.abc import Iterator
from dataclasses import dataclass

from ezdxf.entities import DXFGraphic
from matplotlib.axes import Axes
from matplotlib.font_manager import FontProperties

from agent.drawings.dxf_source import DxfSource

logger = logging.getLogger(__name__)

_PT_PER_MM = 72.0 / 25.4

MAX_TEXTS = 40_000

CAP_HEIGHT_EM = 0.7

_HALIGN = {0: "left", 1: "center", 2: "right", 3: "left", 4: "center", 5: "left"}
_VALIGN = {0: "baseline", 1: "bottom", 2: "center", 3: "top"}
_MTEXT_ATTACHMENT = {
    1: ("left", "top"), 2: ("center", "top"), 3: ("right", "top"),
    4: ("left", "center"), 5: ("center", "center"), 6: ("right", "center"),
    7: ("left", "bottom"), 8: ("center", "bottom"), 9: ("right", "bottom"),
}  # fmt: skip


@dataclass(frozen=True)
class PlacedText:
    x: float
    y: float
    height: float
    text: str
    ha: str
    va: str
    rotation: float
    layer: str


def placed_texts(source: DxfSource) -> Iterator[PlacedText]:
    hidden = {layer.dxf.name.upper() for layer in source.doc.layers if layer.is_off()}
    for entity in source.doc.modelspace():
        layer = entity.dxf.layer.upper()
        if layer in hidden or (source.cadastre and layer == "RL"):
            continue
        kind = entity.dxftype()
        if kind == "TEXT":
            yield _placed_text(entity)
        elif kind == "MTEXT":
            yield _placed_mtext(entity)
        elif kind == "INSERT":
            yield from (_placed_text(attrib) for attrib in entity.attribs if not attrib.is_invisible)


def write_transparent(axes: Axes, texts: Iterator[PlacedText], units_per_mm: float) -> None:
    for count, placed in enumerate(texts):
        if count >= MAX_TEXTS:
            logger.info("dxf: text layer capped at %d entries", MAX_TEXTS)
            return
        size = max(placed.height / units_per_mm * _PT_PER_MM, 1.0)
        _put(axes, placed, size, alpha=0.0)


def write_visible(
    axes: Axes,
    texts: Iterator[PlacedText],
    units_per_mm: float,
    face: FontProperties,
    colour_of: Callable[[str], str],
) -> None:
    for count, placed in enumerate(texts):
        if count >= MAX_TEXTS:
            logger.info("dxf: labels capped at %d entries", MAX_TEXTS)
            return
        if placed.height / units_per_mm < 0.3:
            continue  # BEV's suppressed numbers (§3.8): drawn at 0.01 on purpose, not a label
        props = face.copy()
        props.set_size(placed.height / units_per_mm * _PT_PER_MM / CAP_HEIGHT_EM)
        _put(axes, placed, None, color=colour_of(placed.layer), fontproperties=props)


def _put(axes: Axes, placed: PlacedText, size: float | None, **style: object) -> None:
    if size is not None:
        style["fontsize"] = size
    axes.text(
        placed.x,
        placed.y,
        placed.text,
        ha=placed.ha,
        va=placed.va,
        rotation=placed.rotation,
        rotation_mode="anchor",
        clip_on=True,
        **style,
    )


def _placed_text(entity: DXFGraphic) -> PlacedText:
    halign, valign = entity.dxf.get("halign", 0), entity.dxf.get("valign", 0)
    aligned = (halign or valign) and entity.dxf.hasattr("align_point")
    anchor = entity.dxf.align_point if aligned else entity.dxf.insert
    return PlacedText(
        x=float(anchor[0]),
        y=float(anchor[1]),
        height=float(entity.dxf.height or 1.0),
        text=" ".join(str(entity.dxf.text).split()),
        ha=_HALIGN.get(halign, "left"),
        va="center" if halign == 4 else _VALIGN.get(valign, "baseline"),
        rotation=float(entity.dxf.get("rotation", 0.0)),
        layer=entity.dxf.layer.upper(),
    )


def _placed_mtext(entity: DXFGraphic) -> PlacedText:
    ha, va = _MTEXT_ATTACHMENT.get(entity.dxf.get("attachment_point", 1), ("left", "top"))
    insert = entity.dxf.insert
    return PlacedText(
        x=float(insert[0]),
        y=float(insert[1]),
        height=float(entity.dxf.char_height or 1.0),
        text=" ".join(entity.plain_text().split()),
        ha=ha,
        va=va,
        rotation=float(entity.dxf.get("rotation", 0.0)),
        layer=entity.dxf.layer.upper(),
    )
