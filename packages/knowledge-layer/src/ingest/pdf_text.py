from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import Any

from knowledge_layer.env import env_int

logger = logging.getLogger(__name__)

PDF_PAGE_MAX_OBJECTS = env_int("PDF_PAGE_MAX_OBJECTS", 50_000, minimum=0)

_WATERMARK_PHRASES: list[tuple[str, str]] = [
    (r"vectorworks\s+educational\s+version", r"\s*$"),
    (r"educational\s+version", r"\s*$"),
    (r"produced\s+by\s+an\s+autodesk\s+(student|educational)\s+(version|product)", r".*$"),
    (r"created\s+(in|with)\s+an?\s+.*(trial|evaluation|educational).*version", r"\s*$"),
    (r"(unregistered|evaluation|trial|demo)\s+version", r"\s*$"),
]

WATERMARK_LINE_PATTERNS = [
    re.compile(rf"^\s*{fragment}{suffix}", re.IGNORECASE) for fragment, suffix in _WATERMARK_PHRASES
]


def _strip_watermark_lines(text: str | None) -> str:
    if not text:
        return ""
    kept = [line for line in text.splitlines() if not any(p.match(line) for p in WATERMARK_LINE_PATTERNS)]
    return "\n".join(kept).strip()


class PdfTextPages(list):

    def __init__(
        self,
        pages=(),
        *,
        failed_pages: list[int] | None = None,
        page_count: int = 0,
        dense_pages: list[int] | None = None,
    ) -> None:
        super().__init__(pages)
        self.failed_pages = failed_pages or []
        self.page_count = page_count
        self.dense_pages = dense_pages or []


_MAX_FAILED_PAGE_FRACTION = 0.2


def unreadable_pdf_verdict(text_pages: list[dict[str, Any]]) -> str | None:
    failed = len(getattr(text_pages, "failed_pages", ()))
    total = getattr(text_pages, "page_count", 0)
    if not failed or not total:
        return None
    if failed < total and failed / total <= _MAX_FAILED_PAGE_FRACTION:
        return None
    return f"pdf_pages_unreadable: {failed} of {total} pages could not be read"


def _read_pdf_page(page, page_num: int, previous, pdf_path: str) -> tuple[dict[str, Any] | None, Any]:
    from knowledge_layer.ingest.captioned_tables import extract_page_tables

    try:
        found = extract_page_tables(page, page_num, previous)
    except Exception as exc:  # pragma: no cover - pdfplumber edge cases
        logger.warning("Table finding failed on page %d of %s: %s", page_num, pdf_path, exc)
        found = []
    continued = found[-1][0] if found else None
    boxes = [tuple(bbox) for _table, bbox in found]
    source = page.filter(lambda obj, boxes=boxes: not _inside_any(obj, boxes)) if boxes else page
    text = _strip_watermark_lines(source.extract_text())
    tables = [table for table, _bbox in found]
    if not (text or tables):
        return None, continued
    from knowledge_layer.ingest.section_chunking import extract_line_styles

    styles = extract_line_styles(source) if text else []
    entry = {"page_number": page_num, "text": text, "tables": tables, "table_boxes": boxes, "line_styles": styles}
    entry["image_count"] = _raster_count(page)
    return entry, continued


def _raster_count(page) -> int:
    try:
        return len(page.images)
    except Exception:  # noqa: BLE001 - an uncountable page is counted as carrying one
        return 1


def _dense_page_texts(pdf_path: str, max_objects: int) -> dict[int, dict[str, Any]]:
    if max_objects <= 0:
        return {}
    import pypdfium2 as pdfium
    from knowledge_layer.ingest.pdfium_lock import pdfium_lock

    try:
        with pdfium_lock():
            document = pdfium.PdfDocument(pdf_path)
            page_count = len(document)
    except Exception as exc:  # noqa: BLE001 - the layout pass still reads every page
        logger.warning("Could not count page objects in %s: %s", pdf_path, exc)
        return {}
    dense: dict[int, dict[str, Any]] = {}
    try:
        for index in range(page_count):
            with pdfium_lock():
                read = _dense_page_text(document, index, max_objects)
            if read is not None:
                dense[index + 1] = read
    finally:
        with pdfium_lock():
            document.close()
    return dense


def _dense_page_text(document: Any, index: int, max_objects: int) -> dict[str, Any] | None:
    import pypdfium2.raw as pdfium_c

    try:
        page = document[index]
    except Exception as exc:  # noqa: BLE001 - pdfplumber gets its own try at the page
        logger.warning("Could not load page %d to count its objects: %s", index + 1, exc)
        return None
    try:
        count = pdfium_c.FPDFPage_CountObjects(page.raw)
        if count <= max_objects:
            return None
        textpage = page.get_textpage()
        try:
            text = textpage.get_text_range()
        finally:
            textpage.close()
        rasters = sum(
            1
            for i in range(count)
            if pdfium_c.FPDFPageObj_GetType(pdfium_c.FPDFPage_GetObject(page.raw, i)) == pdfium_c.FPDF_PAGEOBJ_IMAGE
        )
        return {"text": text, "image_count": rasters}
    finally:
        page.close()


def _dense_page_entry(dense: dict[str, Any], page_num: int) -> dict[str, Any] | None:
    text = _strip_watermark_lines(dense["text"])
    if not text:
        return None
    return {
        "page_number": page_num,
        "text": text,
        "tables": [],
        "table_boxes": [],
        "line_styles": [],
        "image_count": dense["image_count"],
    }


def _extract_text_from_pdf(pdf_path: str) -> PdfTextPages:
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed. Install with: pip install pdfplumber")
        return PdfTextPages()

    pages: list[dict[str, Any]] = []
    failed: list[int] = []
    page_count = 0
    dense = _dense_page_texts(pdf_path, PDF_PAGE_MAX_OBJECTS)
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page_count = len(pdf.pages)
            previous = None
            for page_num, page in enumerate(pdf.pages, start=1):
                try:
                    if page_num in dense:
                        entry, previous = _dense_page_entry(dense[page_num], page_num), None
                    else:
                        entry, previous = _read_pdf_page(page, page_num, previous, pdf_path)
                except Exception as exc:  # noqa: BLE001 - one bad page must not cost the rest
                    logger.warning("Text extraction failed on page %d of %s: %s", page_num, pdf_path, exc)
                    failed.append(page_num)
                    previous = None
                    continue
                finally:
                    page.close()
                if entry is not None:
                    pages.append(entry)
        logger.info(
            "Extracted text from %d PDF pages in %s (%d unreadable, %d read without layout)",
            len(pages),
            pdf_path,
            len(failed),
            len(dense),
        )
    except Exception as e:
        logger.error("Error extracting PDF text: %s", e)

    return PdfTextPages(pages, failed_pages=failed, page_count=page_count, dense_pages=sorted(dense))


def _inside_any(obj: dict[str, Any], boxes: list[tuple]) -> bool:
    if "x0" not in obj or "top" not in obj:
        return False
    x = (obj["x0"] + obj.get("x1", obj["x0"])) / 2
    y = (obj["top"] + obj.get("bottom", obj["top"])) / 2
    return any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in boxes)


def pdf_page_texts(content: bytes) -> PdfTextPages:
    handle, path = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(content)
        return _extract_text_from_pdf(path)
    finally:
        os.unlink(path)
