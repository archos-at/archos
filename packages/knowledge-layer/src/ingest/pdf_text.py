"""A PDF's text, page by page: the text pass every ingested PDF goes through.

Moved out of ``adapter`` so that whatever else reads a PDF's text reads the same
text the corpus indexes: a public source's capture (ADR-0170, its quote check
KC-6) and a ``pdf_document`` source's pages (``public_sources``) take
:func:`pdf_page_texts`, and a quote that holds there holds in the index. Light
by design: pdfplumber and pypdfium2, no model client, no vector store.

Each page is read on its own (one broken page costs only itself), closed as
soon as it is read, and a page denser than ``PDF_PAGE_MAX_OBJECTS`` is read by
PDFium without layout. Licence watermarks a CAD tool stamps are dropped.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import Any

from knowledge_layer.env import env_int

logger = logging.getLogger(__name__)

# @environment_variable PDF_PAGE_MAX_OBJECTS
# @category Knowledge Layer
# @type int
# @default 50000
# @required false
# Page objects (paths, text runs, rasters, counted by PDFium) past which a PDF
# page's text is read by PDFium instead of pdfplumber. pdfplumber turns every
# vector path into Python dicts and runs its table finder over every edge:
# measured at about 4 KiB and 0.1 ms per object, so a CAD sheet of 500 000
# paths costs about 2 GiB and minutes for its title block. Such a page keeps
# its text, without captioned tables or line styles, and is counted on the
# file's job status (`pages_read_without_layout`). 0 lifts the ceiling.
PDF_PAGE_MAX_OBJECTS = env_int("PDF_PAGE_MAX_OBJECTS", 50_000, minimum=0)

# Boilerplate / licence watermark lines stamped into the rendered output by
# some CAD tools (Vectorworks/AutoCAD educational licences, "DRAFT", etc.).
# Stripped before the text-length heuristic and before summarisation so a
# drawing page that is 100% linework does not read as "has text" and so the
# summary never describes the watermark instead of the drawing. Matched
# case-insensitively against whole lines (leading/trailing whitespace ignored).
#
# Each entry is (phrase_fragment, line_suffix): the fragment is the bare
# phrase regex (no anchors) and is the single source of truth for both the
# whole-line patterns below and the substring patterns further down (used to
# scrub the phrase out of VLM captions where it can appear mid-sentence). The
# suffix is what follows the phrase to make a *whole line* match: most
# watermarks are just the phrase itself (``\s*$``), but the Autodesk stamp is
# often followed by extra trailing boilerplate on the same line, so it needs
# ``.*$`` instead.
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
    """Drop licence/watermark boilerplate lines (e.g. "VECTORWORKS EDUCATIONAL
    VERSION") from extracted text.

    Runs before both the visual-page heuristic and summarisation: without it a
    drawing page that is pure linework plus a stamped watermark reads as "has
    text" (so it never reaches the VLM) and its watermark becomes the document
    summary. Only whole lines matching a known pattern are removed; real
    content is never touched.
    """
    if not text:
        return ""
    kept = [line for line in text.splitlines() if not any(p.match(line) for p in WATERMARK_LINE_PATTERNS)]
    return "\n".join(kept).strip()


class PdfTextPages(list):
    """``_extract_text_from_pdf``'s pages, plus the pages that could not be read.

    A list, so every caller that iterates pages is unchanged. ``failed_pages``
    is the 1-based numbers of pages whose extraction raised; ``page_count`` is
    how many pages the PDF has (0 when it could not be opened);
    ``dense_pages`` the pages over ``PDF_PAGE_MAX_OBJECTS``, read by PDFium
    without layout (no captioned tables, no line styles).
    """

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


#: The share of a PDF's pages that may fail to read before the file fails. Past
#: it the index would hold a document with holes large enough to mislead: an
#: answer grounded on what is left reads as the whole document.
_MAX_FAILED_PAGE_FRACTION = 0.2


def unreadable_pdf_verdict(text_pages: list[dict[str, Any]]) -> str | None:
    """The file-level failure for too many unreadable pages, or None when the file may stand.

    Takes any list: a caller (or a test double) that returns a plain one has no
    failed pages to report.
    """
    failed = len(getattr(text_pages, "failed_pages", ()))
    total = getattr(text_pages, "page_count", 0)
    if not failed or not total:
        return None
    if failed < total and failed / total <= _MAX_FAILED_PAGE_FRACTION:
        return None
    return f"pdf_pages_unreadable: {failed} of {total} pages could not be read"


def _read_pdf_page(page, page_num: int, previous, pdf_path: str) -> tuple[dict[str, Any] | None, Any]:
    """One page's text and captioned tables, and the table a next page may continue."""
    from knowledge_layer.ingest.captioned_tables import extract_page_tables

    # Captioned tables are read as tables and cut out of the text, which would
    # otherwise read them across their columns (``captioned_tables``).
    # Fail-open: a page whose table finder raises is extracted exactly as before.
    try:
        found = extract_page_tables(page, page_num, previous)
    except Exception as exc:  # pragma: no cover - pdfplumber edge cases
        logger.warning("Table finding failed on page %d of %s: %s", page_num, pdf_path, exc)
        found = []
    # Only the page right after a table can continue it: a page without one
    # ends the chain, or a caption-less box pages later was appended to the old table.
    continued = found[-1][0] if found else None
    boxes = [tuple(bbox) for _table, bbox in found]
    source = page.filter(lambda obj, boxes=boxes: not _inside_any(obj, boxes)) if boxes else page
    text = _strip_watermark_lines(source.extract_text())
    tables = [table for table, _bbox in found]
    if not (text or tables):
        return None, continued
    from knowledge_layer.ingest.section_chunking import extract_line_styles

    # Font size and weight per line, for the heading-aware chunker of tenant PDFs.
    styles = extract_line_styles(source) if text else []
    entry = {"page_number": page_num, "text": text, "tables": tables, "table_boxes": boxes, "line_styles": styles}
    # Rasters on the page, counted from what pdfplumber already parsed: the
    # upload screen reads it to know whether the VLM will see unscreened images.
    entry["image_count"] = _raster_count(page)
    return entry, continued


def _raster_count(page) -> int:
    """How many rasters pdfplumber parsed on ``page``; one when it cannot say.

    Never costs the page its text, and errs toward the screen calling the file
    ``partial`` rather than claiming a raster-free page it did not see.
    """
    try:
        return len(page.images)
    except Exception:  # noqa: BLE001 - an uncountable page is counted as carrying one
        return 1


def _dense_page_texts(pdf_path: str, max_objects: int) -> dict[int, dict[str, Any]]:
    """The pages of ``pdf_path`` holding more than ``max_objects`` page objects, read by PDFium.

    Page number (1-based) to the page's text and raster count. Counting is
    ``FPDFPage_CountObjects``, which parses the page but builds nothing per
    object: 40 sheets of 20 000 paths count in well under a second. The PDFium
    lock is held per page, as ``pdfium_lock`` asks. Fail-open: a PDF PDFium
    cannot open, or a page it cannot load, is left to pdfplumber as before.
    """
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
    """Page ``index``'s text and raster count when it is over ``max_objects``, else None. Inside ``pdfium_lock``."""
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
    """The text-pass entry for a page read by PDFium: its text, no tables, no line styles."""
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
    """Extract per-page text from a PDF without falling back to raw PDF bytes.

    Each page is read on its own: one page pdfplumber cannot parse used to end
    the loop, and every page after it was dropped without a word. A failed page
    is now logged, skipped and counted in ``failed_pages``, and the caller
    decides with ``unreadable_pdf_verdict`` whether the file still stands.

    Memory is one page, not the document. pdfplumber caches every parsed object
    on its ``Page`` until the page is closed, and the pages hang off the open
    ``PDF``: unclosed, a set of CAD sheets held about 77 MiB per sheet of
    20 000 paths until the whole file was read, and two 26-29 MB plan
    collections OOM-killed a 12 GiB worker before this function returned. A
    page is closed as soon as its entry is built, and a page denser than
    ``PDF_PAGE_MAX_OBJECTS`` never reaches pdfplumber at all
    (``_dense_page_texts``).
    """
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
    """Whether a pdfplumber object's centre lies in any of ``boxes`` (x0, top, x1, bottom)."""
    if "x0" not in obj or "top" not in obj:
        return False
    x = (obj["x0"] + obj.get("x1", obj["x0"])) / 2
    y = (obj["top"] + obj.get("bottom", obj["top"])) / 2
    return any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in boxes)


def pdf_page_texts(content: bytes) -> PdfTextPages:
    """The text pass over a PDF held in memory: :func:`_extract_text_from_pdf` on a private temporary copy."""
    handle, path = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(content)
        return _extract_text_from_pdf(path)
    finally:
        os.unlink(path)
