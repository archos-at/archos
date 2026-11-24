from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from knowledge_layer.sheet.figures import group_figures
from knowledge_layer.sheet.reader import read_characters
from knowledge_layer.view_regions import region_box_pt

logger = logging.getLogger(__name__)

MAX_FIGURES = 60
MAX_CHARACTERS = 2400

Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class CropText:
    head: str
    lines: tuple[str, ...] = ()


def figures_in_box(figures: list[dict[str, Any]], box: Box | None) -> list[dict[str, Any]]:
    if box is None:
        return figures
    left, top, width, height = box
    return [
        figure
        for figure in figures
        if left <= figure["centre"][0] <= left + width and top <= figure["centre"][1] <= top + height
    ]


def _bounded(figures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(figures) <= MAX_FIGURES and sum(len(figure["text"]) for figure in figures) <= MAX_CHARACTERS:
        return figures
    kept: list[dict[str, Any]] = []
    spent = 0
    for figure in sorted(figures, key=lambda item: -item["height"]):
        if len(kept) == MAX_FIGURES:
            break
        if spent + len(figure["text"]) > MAX_CHARACTERS:
            continue
        kept.append(figure)
        spent += len(figure["text"])
    chosen = {id(figure) for figure in kept}
    return [figure for figure in figures if id(figure) in chosen]


def sheet_line(page: dict[str, Any]) -> str:
    size = f"{page['width_mm']:.0f} x {page['height_mm']:.0f} mm"
    named = f" ({page['format']})" if page["format"] else ""
    return f"The sheet is {size}{named} as shown."


def _line(figure: dict[str, Any], page: dict[str, Any]) -> str:
    x, y = figure["centre"][0] / page["width_pt"], figure["centre"][1] / page["height_pt"]
    turned = f" | {figure['angle']}°" if figure["angle"] else ""
    return f"{figure['text']} | x={x:.3f} y={y:.3f}{turned}"


def crop_text(page: dict[str, Any], figures: list[dict[str, Any]], box: Box | None) -> CropText:
    where = "inside this box" if box is not None else "on this page"
    if not figures:
        return CropText(
            f"{sheet_line(page)} This page has no text layer: nothing printed on it can be read as text, only "
            "seen in the image."
        )
    inside = figures_in_box(figures, box)
    if not inside:
        return CropText(f"{sheet_line(page)} No printed text has its centre {where}.")
    shown = _bounded(inside)
    cut = (
        f" {len(shown)} of {len(inside)} are listed, the largest text first; look at a smaller region for the rest."
        if len(shown) < len(inside)
        else ""
    )
    head = (
        f"{sheet_line(page)} Printed text {where}, read from the file's text layer and not from the image "
        "(each line: the text as printed | its centre as shares of the page | its direction when not left to "
        f"right). A raised final digit is written as a superscript. Text cut by the box edge is left out. Quote a printed figure from this list, not from the image.{cut}"
    )
    return CropText(head, tuple(_line(figure, page) for figure in shown))


def read_crop_text(source: str | bytes, page_number: int, box_pt: Any = None) -> CropText | None:
    try:
        sheet = read_characters(source, page_number)
        page = sheet["page"]
        box = box_pt(page["width_pt"], page["height_pt"]) if callable(box_pt) else box_pt
        return crop_text(page, group_figures(sheet["characters"]), box)
    except Exception:  # noqa: BLE001 - a look still shows its image when the text layer cannot be read
        logger.warning("look: the text layer of page %s could not be read", page_number, exc_info=True)
        return None


async def look_text(source: str | bytes, page_number: int, region: Any, timeout: float) -> CropText | None:

    def box(width_pt: float, height_pt: float) -> Box | None:
        return region_box_pt(region, width_pt, height_pt) if region is not None else None

    try:
        return await asyncio.wait_for(asyncio.to_thread(read_crop_text, source, page_number, box), timeout=timeout)
    except Exception:  # noqa: BLE001 - the image is still shown
        logger.warning("look: reading the text layer of page %s did not finish", page_number, exc_info=True)
        return None
