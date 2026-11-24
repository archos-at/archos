from __future__ import annotations

import ctypes
import io
import math
from array import array
from contextlib import closing
from typing import Any

from knowledge_layer.ingest import pdfium_lock
from knowledge_layer.ingest import pdfium_pause

MAX_SEGMENTS_PER_PAGE = 2_000_000
MAX_CHARACTERS_PER_PAGE = 400_000

MM_PER_POINT = 25.4 / 72

_ISO_216 = {"A0": (841, 1189), "A1": (594, 841), "A2": (420, 594), "A3": (297, 420), "A4": (210, 297)}
_FORMAT_TOLERANCE_MM = 3.0

DASHED = 1
FILL_EDGE = 2

_BEZIER = 1  # FPDF_SEGMENT_BEZIERTO
_MOVE = 2  # FPDF_SEGMENT_MOVETO
_PATH = 2  # FPDF_PAGEOBJ_PATH
_IMAGE = 3  # FPDF_PAGEOBJ_IMAGE
_FORM = 5  # FPDF_PAGEOBJ_FORM
_MAX_FORM_DEPTH = 8
PAUSE_EVERY_OBJECTS = 2_000

Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


class SheetTooLarge(Exception):
    def __init__(self, segments: int) -> None:
        super().__init__(f"the page holds more than {segments:,} line segments")
        self.segments = segments


class TextTooLarge(ValueError):
    def __init__(self, characters: int) -> None:
        super().__init__(f"the page's text layer holds more than {characters:,} characters")
        self.characters = characters


def to_shown(x: float, y: float, width_u: float, height_u: float, rotate: int) -> tuple[float, float]:
    if rotate == 0:
        return x, height_u - y
    if rotate == 90:
        return y, x
    if rotate == 180:
        return width_u - x, y
    return height_u - y, width_u - x


def direction_shown(a: float, b: float, rotate: int) -> tuple[float, float]:
    dx, dy = {0: (a, -b), 90: (b, a), 180: (-a, b)}.get(rotate, (-b, -a))
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


def sheet_format(width_mm: float, height_mm: float) -> str | None:
    short, long = sorted((width_mm, height_mm))
    for name, (iso_short, iso_long) in _ISO_216.items():
        if abs(short - iso_short) <= _FORMAT_TOLERANCE_MM and abs(long - iso_long) <= _FORMAT_TOLERANCE_MM:
            return name
    return None


def _frame(page: Any) -> dict[str, Any]:
    left, bottom, right, top = (float(value) for value in page.get_bbox())
    box = (min(left, right), min(bottom, top), max(left, right), max(bottom, top))
    return {"box": box, "rotation": int(page.get_rotation()) % 360}


def _finish_frame(frame: dict[str, Any], user_unit: float) -> dict[str, Any]:
    x0, y0, x1, y1 = frame["box"]
    turned = frame["rotation"] in (90, 270)
    width_pt, height_pt = (y1 - y0, x1 - x0) if turned else (x1 - x0, y1 - y0)
    width_mm, height_mm = width_pt * user_unit * MM_PER_POINT, height_pt * user_unit * MM_PER_POINT
    return {
        **frame,
        "user_unit": user_unit,
        "width_pt": width_pt,
        "height_pt": height_pt,
        "width_mm": width_mm,
        "height_mm": height_mm,
        "format": sheet_format(width_mm, height_mm),
    }


def _compose(inner: Matrix, outer: Matrix) -> Matrix:
    a, b, c, d, e, f = inner
    oa, ob, oc, od, oe, of = outer
    return (
        a * oa + b * oc,
        a * ob + b * od,
        c * oa + d * oc,
        c * ob + d * od,
        e * oa + f * oc + oe,
        e * ob + f * od + of,
    )


def _object_matrix(raw: Any, obj: Any) -> Matrix:
    matrix = raw.FS_MATRIX()
    if not raw.FPDFPageObj_GetMatrix(obj, matrix):
        return _IDENTITY
    return (matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)


def _raw_path(raw: Any, obj: Any, outer: Matrix) -> tuple | None:
    fill_mode, stroke = ctypes.c_int(), ctypes.c_int()
    raw.FPDFPath_GetDrawMode(obj, fill_mode, stroke)
    if not stroke.value and not fill_mode.value:
        return None
    points: list[tuple[float, float, int, int]] = []
    x, y = ctypes.c_float(), ctypes.c_float()
    for index in range(raw.FPDFPath_CountSegments(obj)):
        segment = raw.FPDFPath_GetPathSegment(obj, index)
        raw.FPDFPathSegment_GetPoint(segment, x, y)
        points.append((x.value, y.value, raw.FPDFPathSegment_GetType(segment), raw.FPDFPathSegment_GetClose(segment)))
    width = ctypes.c_float()
    red, green, blue, alpha = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    if stroke.value:
        raw.FPDFPageObj_GetStrokeWidth(obj, width)
        raw.FPDFPageObj_GetStrokeColor(obj, red, green, blue, alpha)
        dashed = raw.FPDFPageObj_GetDashCount(obj) > 0
    else:
        raw.FPDFPageObj_GetFillColor(obj, red, green, blue, alpha)
        dashed = False
    flags = (DASHED if dashed else 0) | (0 if stroke.value else FILL_EDGE)
    colour = (red.value << 16) | (green.value << 8) | blue.value
    return points, _compose(_object_matrix(raw, obj), outer), width.value if stroke.value else 0.0, flags, colour


def _keep_path(raw: Any, obj: Any, outer: Matrix, out: dict[str, Any]) -> None:
    path = _raw_path(raw, obj, outer)
    if path is None:
        return
    out["points"] += len(path[0])
    if out["points"] > MAX_SEGMENTS_PER_PAGE * 2:
        raise SheetTooLarge(MAX_SEGMENTS_PER_PAGE)
    out["paths"].append(path)


def _walk(raw: Any, count: int, get: Any, outer: Matrix, depth: int, out: dict[str, Any]) -> None:
    for index in range(count):
        out["objects"] += 1
        if out["objects"] % PAUSE_EVERY_OBJECTS == 0:
            pdfium_pause()
        obj = get(index)
        kind = raw.FPDFPageObj_GetType(obj)
        if kind == _PATH:
            _keep_path(raw, obj, outer, out)
        elif kind == _IMAGE:
            out["images"] += 1
        elif kind == _FORM and depth < _MAX_FORM_DEPTH:
            _walk_form(raw, obj, outer, depth, out)


def _walk_form(raw: Any, form: Any, outer: Matrix, depth: int, out: dict[str, Any]) -> None:
    inner = _compose(_object_matrix(raw, form), outer)
    count = raw.FPDFFormObj_CountObjects(form)
    _walk(raw, count, lambda index: raw.FPDFFormObj_GetObject(form, index), inner, depth + 1, out)


def _raw_character(raw: Any, text_page: Any, index: int) -> tuple | None:
    code = raw.FPDFText_GetUnicode(text_page, index)
    if code <= 32 or code in (0xA0, 0xFFFE, 0xFFFF) or raw.FPDFText_IsGenerated(text_page, index) == 1:
        return None
    loose = raw.FS_RECTF()
    if not raw.FPDFText_GetLooseCharBox(text_page, index, loose):
        return None
    origin_x, origin_y = ctypes.c_double(), ctypes.c_double()
    raw.FPDFText_GetCharOrigin(text_page, index, origin_x, origin_y)
    matrix = raw.FS_MATRIX()
    raw.FPDFText_GetMatrix(text_page, index, matrix)
    return (
        chr(code),
        (loose.left, loose.bottom, loose.right, loose.top),
        (origin_x.value, origin_y.value),
        (matrix.a, matrix.b, matrix.c, matrix.d),
        raw.FPDFText_GetFontSize(text_page, index),
    )


def _raw_characters(raw: Any, text_page: Any) -> list[tuple]:
    count = raw.FPDFText_CountChars(text_page)
    if count > MAX_CHARACTERS_PER_PAGE:
        raise TextTooLarge(MAX_CHARACTERS_PER_PAGE)
    return [char for index in range(count) if (char := _raw_character(raw, text_page, index)) is not None]


def _open(source: str | bytes) -> Any:
    import pypdfium2 as pdfium

    return pdfium.PdfDocument(source)


def _read_page(raw: Any, page: Any, *, paths: bool) -> tuple[dict[str, Any], list[tuple], dict[str, Any]]:
    drawn: dict[str, Any] = {"paths": [], "points": 0, "images": 0, "objects": 0}
    frame = _frame(page)
    text_page = page.get_textpage()
    try:
        characters = _raw_characters(raw, text_page)
    finally:
        text_page.close()
    if paths:
        count = raw.FPDFPage_CountObjects(page)
        _walk(raw, count, lambda index: raw.FPDFPage_GetObject(page, index), _IDENTITY, 0, drawn)
    return frame, characters, drawn


def _read_raw(
    source: str | bytes, page_number: int, *, paths: bool
) -> tuple[dict[str, Any], list[tuple], dict[str, Any]]:
    from pypdfium2 import raw

    with pdfium_lock(), closing(_open(source)) as document:
        if not 1 <= page_number <= len(document):
            raise ValueError(f"page {page_number} is not in the document ({len(document)} pages)")
        with closing(document[page_number - 1]) as page:
            return _read_page(raw, page, paths=paths)


def _chords(points: list[tuple], place: Any) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    out: list[tuple[tuple[float, float], tuple[float, float]]] = []
    previous = first = None
    pending = 0
    for px, py, kind, close in points:
        here = place(px, py)
        if kind == _MOVE:
            previous, first, pending = here, here, 0
            continue
        pending = pending + 1 if kind == _BEZIER else 0
        if 0 < pending < 3:
            continue
        pending = 0
        if previous is not None and previous != here:
            out.append((previous, here))
        previous = here
        if close and first is not None and first != here:
            out.append((here, first))
            previous = first
    return out


def _segments(drawn: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
    x0, y0, x1, y1 = frame["box"]
    width_u, height_u, rotate = x1 - x0, y1 - y0, frame["rotation"]
    coords, widths, flags, colours = array("d"), array("f"), array("B"), array("L")
    for points, (a, b, c, d, e, f), width, flag, colour in drawn["paths"]:

        def place(px: float, py: float, m: Matrix = (a, b, c, d, e, f)) -> tuple[float, float]:
            return to_shown(
                m[0] * px + m[2] * py + m[4] - x0, m[1] * px + m[3] * py + m[5] - y0, width_u, height_u, rotate
            )

        chords = _chords(points, place)
        coords.extend(value for start, end in chords for value in (*start, *end))
        widths.extend([width * math.sqrt(abs(a * d - b * c))] * len(chords))
        flags.extend([flag] * len(chords))
        colours.extend([colour] * len(chords))
    if len(widths) > MAX_SEGMENTS_PER_PAGE:
        raise SheetTooLarge(MAX_SEGMENTS_PER_PAGE)
    return {"coords": coords, "width": widths, "flags": flags, "colour": colours}


def _advance(width: float, height: float, cos: float, sin: float) -> tuple[float, float] | None:
    cos, sin = abs(cos), abs(sin)
    spread = cos * cos - sin * sin
    if abs(spread) < 0.2:
        return None
    return (width * cos - height * sin) / spread, (height * cos - width * sin) / spread


def _character(raw_character: tuple, frame: dict[str, Any]) -> tuple[list, float | None]:
    x0, y0, x1, y1 = frame["box"]
    width_u, height_u, rotate = x1 - x0, y1 - y0, frame["rotation"]
    text, (left, bottom, right, top), (ox, oy), (a, b, c, d), font_size = raw_character
    if not a and not b:
        a = 1.0
    if not c and not d:
        c, d = -b, a
    ax, ay = to_shown(left - x0, bottom - y0, width_u, height_u, rotate)
    bx, by = to_shown(right - x0, top - y0, width_u, height_u, rotate)
    sx, sy = to_shown(ox - x0, oy - y0, width_u, height_u, rotate)
    size = font_size * (math.hypot(c, d) or 1.0) or abs(by - ay)
    length = math.hypot(a, b)
    solved = _advance(right - left, top - bottom, a / length, b / length)
    shown = [text, sx, sy, min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)]
    shown += [*direction_shown(a, b, rotate), size, solved[0] if solved else 0.0, *direction_shown(c, d, rotate)]
    turned = (right - left) / max(abs(a / length), abs(b / length)) if solved is None else None
    return shown, turned


def _characters(raw_characters: list[tuple], frame: dict[str, Any]) -> list[tuple]:
    shown = [_character(raw_character, frame) for raw_character in raw_characters]
    ratios = sorted((c[6] - c[4]) / c[9] for c, turned in shown if turned is None and c[9] and abs(c[8]) < 0.05)
    height_ratio = ratios[len(ratios) // 2] if ratios else 1.1
    for character, turned in shown:
        if turned is not None:
            character[10] = max(turned - height_ratio * character[9], 0.0)
    return [tuple(character) for character, _ in shown]


def _text(value: Any) -> str:
    if isinstance(value, bytes):
        encoding = "utf-16" if value.startswith((b"\xfe\xff", b"\xff\xfe")) else "latin-1"
        return value.decode(encoding, errors="replace")
    return str(value) if value is not None else ""


def _number_format(entry: Any) -> tuple[str, float] | None:
    from pdfminer.pdftypes import resolve1

    entry = resolve1(entry)
    factor = resolve1(entry.get("C")) if isinstance(entry, dict) else None
    if not isinstance(factor, int | float):
        return None
    return _text(resolve1(entry.get("U"))).strip(), float(factor)


def _number_formats(value: Any) -> list[tuple[str, float]] | None:
    from pdfminer.pdftypes import resolve1

    entries = resolve1(value)
    if not isinstance(entries, list):
        return None
    return [pair for entry in entries if (pair := _number_format(entry)) is not None]


def _region(viewport: Any, frame: dict[str, Any]) -> dict[str, Any] | None:
    from pdfminer.pdftypes import resolve1

    viewport = resolve1(viewport)
    if not isinstance(viewport, dict):
        return None
    bbox = resolve1(viewport.get("BBox"))
    measure = resolve1(viewport.get("Measure"))
    if not isinstance(bbox, list) or len(bbox) != 4 or not isinstance(measure, dict):
        return None
    x0, y0, x1, y1 = frame["box"]
    width_u, height_u, rotate = x1 - x0, y1 - y0, frame["rotation"]
    left, bottom, right, top = (float(resolve1(value)) for value in bbox)
    ax, ay = to_shown(left - x0, bottom - y0, width_u, height_u, rotate)
    bx, by = to_shown(right - x0, top - y0, width_u, height_u, rotate)
    subtype = resolve1(measure.get("Subtype"))
    cyx = resolve1(measure.get("CYX"))
    return {
        "box": (min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)),
        "name": _text(resolve1(viewport.get("Name"))),
        "subtype": getattr(subtype, "name", None) or _text(subtype) or "RL",
        "ratio": _text(resolve1(measure.get("R"))),
        "x": _number_formats(measure.get("X")) or [],
        "y": _number_formats(measure.get("Y")),
        "cyx": float(cyx) if isinstance(cyx, int | float) else None,
    }


def _page_entries(stream: Any, page_number: int) -> dict[str, Any]:
    from pdfminer.pdfdocument import PDFDocument
    from pdfminer.pdfpage import PDFPage
    from pdfminer.pdfparser import PDFParser
    from pdfminer.pdftypes import resolve1

    pages = PDFPage.create_pages(PDFDocument(PDFParser(stream)))
    page = next((page for index, page in enumerate(pages, start=1) if index == page_number), None)
    if page is None:
        return {"user_unit": 1.0, "viewports": []}
    user_unit = resolve1(page.attrs.get("UserUnit"))
    viewports = resolve1(page.attrs.get("VP"))
    return {
        "user_unit": float(user_unit) if isinstance(user_unit, int | float) and user_unit > 0 else 1.0,
        "viewports": viewports if isinstance(viewports, list) else [],
    }


def read_page_entries(source: str | bytes, page_number: int) -> dict[str, Any]:
    if isinstance(source, str):
        with open(source, "rb") as stream:
            return _page_entries(stream, page_number)
    return _page_entries(io.BytesIO(source), page_number)


def read_characters(source: str | bytes, page_number: int) -> dict[str, Any]:
    frame, raw_characters, _ = _read_raw(source, page_number, paths=False)
    try:
        user_unit = read_page_entries(source, page_number)["user_unit"]
    except Exception:  # noqa: BLE001 - a page dictionary pdfminer cannot parse still has characters
        user_unit = 1.0
    page = _finish_frame(frame, user_unit)
    return {"page": page, "characters": _characters(raw_characters, page)}


def read_sheet(source: str | bytes, page_number: int) -> dict[str, Any]:
    frame, raw_characters, drawn = _read_raw(source, page_number, paths=True)
    entries = read_page_entries(source, page_number)
    page = _finish_frame(frame, entries["user_unit"])
    segments = _segments(drawn, page)
    regions = [region for viewport in entries["viewports"] if (region := _region(viewport, page)) is not None]
    return {
        "page": page,
        "segments": segments,
        "characters": _characters(raw_characters, page),
        "regions": regions,
        "scan": not segments["width"] and drawn["images"] > 0,
        "images": drawn["images"],
    }
