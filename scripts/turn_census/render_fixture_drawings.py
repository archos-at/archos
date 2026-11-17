from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

from PIL import Image
from PIL import ImageDraw
from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
SPEC = ROOT / "tests" / "fixtures" / "visual" / "drawings.json"
INK = 0
PAPER = 255
MM_PER_INCH = 25.4


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def page_pixels(spec: dict[str, Any], drawing: dict[str, Any], dpi: int | None = None) -> tuple[int, int]:
    width_mm, height_mm = spec["sheets"][drawing["sheet"]]
    dpi = dpi or spec["dpi"]
    return round(width_mm / MM_PER_INCH * dpi), round(height_mm / MM_PER_INCH * dpi)


def pixel_box(box: list[float], size: tuple[int, int]) -> tuple[int, int, int, int]:
    width, height = size
    x, y, w, h = box
    return round(x * width), round(y * height), round((x + w) * width), round((y + h) * height)


FONT_FILES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
)
_TRANSLITERATION = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"})


def font_path() -> str | None:
    for candidate in FONT_FILES:
        if Path(candidate).exists():
            return candidate
    try:
        import matplotlib

        bundled = Path(matplotlib.get_data_path()) / "fonts" / "ttf" / "DejaVuSans.ttf"
        return str(bundled) if bundled.exists() else None
    except ImportError:
        return None


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = font_path()
    if path is None:
        return ImageFont.load_default(size=max(size, 6))
    return ImageFont.truetype(path, max(size, 6))


def drawable(text: str) -> str:
    return text if font_path() else text.translate(_TRANSLITERATION)


def draw_text(draw: ImageDraw.ImageDraw, area: tuple[int, int, int, int], text: str) -> None:
    left, top, right, bottom = area
    size = int((bottom - top) * 0.7)
    font = _font(size)
    while size > 6 and draw.textlength(drawable(text), font=font) > (right - left) * 0.96:
        size -= 2
        font = _font(size)
    draw.text((left + 2, (top + bottom) / 2), drawable(text), font=font, fill=INK, anchor="lm")


def draw_symbol(draw: ImageDraw.ImageDraw, area: tuple[int, int, int, int], symbol: str) -> None:
    left, top, right, bottom = area
    side = min(right - left, bottom - top)
    x0, y0 = left, top + ((bottom - top) - side) // 2
    x1, y1 = x0 + side, y0 + side
    line = max(2, side // 20)
    if symbol == "hatched_square":
        draw.rectangle((x0, y0, x1, y1), outline=INK, width=line)
        for c in range(side // 5, 2 * side, side // 5):
            start = (x0 + c, y0) if c <= side else (x1, y0 + c - side)
            end = (x0, y0 + c) if c <= side else (x0 + c - side, y1)
            draw.line((*start, *end), fill=INK, width=line)
    elif symbol == "circle_cross":
        draw.ellipse((x0, y0, x1, y1), outline=INK, width=line)
        draw.line((x0 + side * 0.15, y0 + side * 0.15, x1 - side * 0.15, y1 - side * 0.15), fill=INK, width=line)
        draw.line((x0 + side * 0.15, y1 - side * 0.15, x1 - side * 0.15, y0 + side * 0.15), fill=INK, width=line)
    elif symbol == "triangle":
        draw.polygon([(x0 + side / 2, y0), (x1, y1), (x0, y1)], fill=INK)
    else:
        raise ValueError(f"unknown legend symbol {symbol!r}")


def draw_door(draw: ImageDraw.ImageDraw, area: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = area
    line = max(3, (bottom - top) // 12)
    side = min(right - left, bottom - top)
    draw.line((left, bottom, left, bottom - side), fill=INK, width=line)
    draw.arc((left - side, bottom - 2 * side, left + side, bottom), start=270, end=360, fill=INK, width=line)


def draw_element(draw: ImageDraw.ImageDraw, element: dict[str, Any], size: tuple[int, int]) -> None:
    area = pixel_box(element["box"], size)
    kind = element["kind"]
    line = max(3, size[0] // 900)
    if kind == "room":
        draw.rectangle(area, outline=INK, width=line * 2)
        left, top, right, _ = area
        draw_text(draw, (left + line * 4, top + line * 4, right, top + line * 4 + (right - left) // 8), element["text"])
    elif kind in ("dimension", "note"):
        draw_text(draw, area, element["text"])
    elif kind == "door":
        draw_door(draw, area)
    elif kind in ("legend_frame", "title_block"):
        draw.rectangle(area, outline=INK, width=line)
        if kind == "legend_frame":
            left, top, right, _ = area
            draw_text(
                draw, (left + line * 3, top + line * 3, right, top + line * 3 + (right - left) // 6), element["text"]
            )
    elif kind == "legend_entry":
        left, top, right, bottom = area
        cut = left + round((right - left) * 0.22)
        draw_symbol(draw, (left, top, cut, bottom), element["symbol"])
        draw_text(draw, (cut + line * 4, top, right, bottom), element["text"])
    elif kind == "title_field":
        draw_text(draw, area, element["text"])
    elif kind == "plan_area":
        return  # the gold box of a count; nothing of its own is drawn
    else:
        raise ValueError(f"unknown element kind {kind!r}")


def render_page(
    spec: dict[str, Any], drawing: dict[str, Any], page: dict[str, Any], dpi: int | None = None
) -> Image.Image:
    size = page_pixels(spec, drawing, dpi)
    image = Image.new("L", size, PAPER)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline=INK, width=max(3, size[0] // 600))
    for element in page["elements"]:
        draw_element(draw, element, size)
    return image


def render_pdf(spec: dict[str, Any], drawing: dict[str, Any], dpi: int | None = None) -> bytes:
    dpi = dpi or spec["dpi"]
    pages = [render_page(spec, drawing, page, dpi) for page in drawing["pages"]]
    buffer = io.BytesIO()
    pages[0].save(buffer, "PDF", save_all=True, append_images=pages[1:], resolution=float(dpi))
    return buffer.getvalue()


def render_all(out: Path, spec: dict[str, Any] | None = None, dpi: int | None = None) -> dict[str, Path]:
    spec = spec or load_spec()
    out.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for drawing in spec["drawings"]:
        path = out / drawing["file_name"]
        path.write_bytes(render_pdf(spec, drawing, dpi))
        written[drawing["file_name"]] = path
    return written


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("fixture-drawings")
    for name, path in render_all(target).items():
        print(f"{name}: {path.stat().st_size} bytes")
