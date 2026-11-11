"""Which PDF the agent means, its bytes, and the sheet of one of its pages, cached (ADR-0182).

The document is resolved the way ``look`` resolves one and its object key comes
from the BFF's scoped lookup (``GET /api/internal/document-file``), exactly as
for a DXF (``source.py``, whose argument this repeats): the lookup answers only
inside the scope the turn's envelope signs, a read is reported
(``note_collections_read``), and the bytes are read on the backend's read-only
object-store credential.

**The cache is tenant data and is never a way in.** Every call asks the BFF
first; only a caller it has just answered for reaches a cached sheet. Where it
differs from the DXF cache, because these are the places that one would fail
here:

* a sheet is keyed by ``(bucket, object key, page)``: a version's own object,
  so a new version is never served the old sheet, and one page at a time;
* the bound is on SEGMENTS, not source bytes: one page holds at most what the
  reader allows (it refuses a larger one with the count), and all cached sheets
  together at most :data:`CACHE_SEGMENTS` (a figure weighs
  :data:`FIGURE_WEIGHT` of them) and never more than :data:`CACHE_SHEETS`;
* a file's bytes are kept once per file (:data:`BYTES_FILES`), so a second page
  does not fetch a 150 MB set again.

This is the one module of the agent that imports the sheet reader
(``knowledge_layer.sheet``); the import contract carries the exception. The
reader's plain values become ``agent.drawings.sheet_types`` here.
"""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from dataclasses import dataclass

from agent import project_context
from agent.common import bff_http
from agent.common import seaweed_s3
from agent.drawings.sheet_types import Sheet
from agent.drawings.sheet_types import sheet_from_plain
from agent.knowledge.restricted_use import note_collections_read

from ..canvas.calls import Refused
from ..look.register import licence_of
from ..look.resolve import Resolved
from ..look.resolve import resolve_document

DOCUMENT_FILE_PATH = "/api/internal/document-file"
TOOL = "drawing_measure"

MAX_PDF_BYTES = 150 * 1024 * 1024
#: Segments held by all cached sheets together; one page alone may hold up to the reader's own bound.
CACHE_SEGMENTS = 3_000_000
#: Sheets held at most, whatever they weigh: a page of text alone has no segments to count.
CACHE_SHEETS = 12
#: What a printed figure weighs against the segment bound (it holds a string, a box and a direction).
FIGURE_WEIGHT = 8
#: Files whose bytes are kept, so another page of the same set costs no second fetch.
BYTES_FILES = 2
READ_TIMEOUT_S = 90

_SheetKey = tuple[str, str, int]
_SHEETS: OrderedDict[_SheetKey, Sheet] = OrderedDict()
_BYTES: OrderedDict[tuple[str, str], bytes] = OrderedDict()
_LOCK = threading.Lock()
#: One lock per page being read, so parallel calls in one round read it once.
_READING: dict[_SheetKey, threading.Lock] = {}

NO_ENVELOPE = (
    f"{TOOL} acts for the person in this conversation, and this run carries no signed request context to act "
    "with, so no project file can be read."
)


@dataclass(frozen=True)
class LoadedSheet:
    """The sheet, and what the answer and a calibration name it by."""

    file_name: str
    page: int
    sheet: Sheet
    collection: str
    document_id: str | None
    version_id: str | None


class SheetUnavailableError(Exception):
    """The page could not be read: a sentence the model relays as it is."""


@dataclass(frozen=True)
class _Located:
    bucket: str
    key: str
    document_id: str | None
    version_id: str | None


async def load_sheet(document: str, page: int) -> LoadedSheet | str:
    """The sheet of page ``page`` of the PDF ``document`` names, or the sentence the model reads instead."""
    try:
        resolved = await resolve_document(document)
    except Refused as refused:
        return str(refused)
    if isinstance(resolved, str):
        return resolved
    return await load_resolved_sheet(resolved, page)


async def load_resolved_sheet(resolved: Resolved, page: int) -> LoadedSheet | str:
    """The sheet of a file whose collection is known already: every check ``load_sheet`` makes once it is named."""
    if not resolved.collection:
        return f"'{resolved.file_name}' is a base-corpus document, not a drawing of this project."
    if not resolved.file_name.lower().endswith(".pdf"):
        return (
            f"'{resolved.file_name}' is no PDF. {TOOL} reads the pages of a PDF drawing; for a DXF use dxf_measure, "
            "for an IFC model ifc_measure, for an image look."
        )
    # A licensed copy's text reaches a model only inside a licensed hit (ADR-0164); this tool prints figures
    # as plain text, so it does not read one at all.
    licence = await licence_of(resolved)
    if licence is not None and licence.licensed:
        return f"'{resolved.file_name}' is a licensed copy: {TOOL} does not read it. Look at the page instead."
    # The turn's own envelope, echoed and never signed here (``source.load_site`` says why).
    header, signature = project_context.get_request_envelope_from_context()
    if not (header and signature):
        return NO_ENVELOPE
    headers = bff_http.SignedEnvelope(header=header, signature=signature).headers()
    try:
        located, sheet = await asyncio.wait_for(
            asyncio.to_thread(_sheet, resolved.collection, resolved.file_name, page, headers), READ_TIMEOUT_S
        )
    except SheetUnavailableError as exc:
        return str(exc)
    except TimeoutError:
        return f"Page {page} of '{resolved.file_name}' takes too long to read; try again shortly."
    note_collections_read([resolved.collection])
    return LoadedSheet(resolved.file_name, page, sheet, resolved.collection, located.document_id, located.version_id)


def _sheet(collection: str, file_name: str, page: int, headers: dict[str, str]) -> tuple[_Located, Sheet]:
    located = _locate(collection, file_name, headers)
    key = (located.bucket, located.key, page)
    with _LOCK:
        reading = _READING.setdefault(key, threading.Lock())
    try:
        sheet = _read_once(reading, key, located, file_name)
    finally:
        # Also when the read failed: a page that cannot be read must not leave its lock behind for good.
        with _LOCK:
            _READING.pop(key, None)
    return located, sheet


def _read_once(reading: threading.Lock, key: _SheetKey, located: _Located, file_name: str) -> Sheet:
    """The cached sheet, or the page read under its own lock so parallel calls read it once."""
    with reading:
        sheet = _cached(key)
        if sheet is None:
            sheet = _read_sheet(_bytes(located), key[2], file_name)
            _remember(key, sheet)
        return sheet


def _read_sheet(data: bytes, page: int, file_name: str) -> Sheet:
    """One page through the reader and the figure grouping, as a :class:`Sheet`."""
    from knowledge_layer.sheet.figures import group_figures
    from knowledge_layer.sheet.reader import SheetTooLarge
    from knowledge_layer.sheet.reader import read_sheet

    try:
        plain = read_sheet(data, page)
    except SheetTooLarge as exc:
        raise SheetUnavailableError(
            f"Page {page} of '{file_name}' holds more than {exc.segments:,} line segments, more than one page may: "
            "it is not measured. Ask for the sheet to be plotted with less detail, or read it with look."
        ) from exc
    except ValueError as exc:
        raise SheetUnavailableError(f"'{file_name}': {exc}.") from exc
    except Exception as exc:  # noqa: BLE001 - any reader fault is one sentence to the model
        raise SheetUnavailableError(f"Page {page} of '{file_name}' could not be read as a PDF page.") from exc
    return sheet_from_plain(plain, group_figures(plain["characters"]))


def _cached(key: _SheetKey) -> Sheet | None:
    with _LOCK:
        if key not in _SHEETS:
            return None
        _SHEETS.move_to_end(key)
        return _SHEETS[key]


def _remember(key: _SheetKey, sheet: Sheet) -> None:
    with _LOCK:
        _SHEETS[key] = sheet
        while len(_SHEETS) > 1 and (len(_SHEETS) > CACHE_SHEETS or _held() > CACHE_SEGMENTS):
            _SHEETS.popitem(last=False)


def _held() -> int:
    """What the cached sheets weigh, in segments: a figure counts as :data:`FIGURE_WEIGHT` of them."""
    return sum(len(kept.segments) + FIGURE_WEIGHT * len(kept.figures) for kept in _SHEETS.values())


def _bytes(located: _Located) -> bytes:
    """The file's bytes, fetched once per file and kept for the next page of it."""
    key = (located.bucket, located.key)
    with _LOCK:
        if key in _BYTES:
            _BYTES.move_to_end(key)
            return _BYTES[key]
    data = _read(located.bucket, located.key)
    with _LOCK:
        _BYTES[key] = data
        while len(_BYTES) > BYTES_FILES:
            _BYTES.popitem(last=False)
    return data


def _locate(collection: str, file_name: str, headers: dict[str, str]) -> _Located:
    """The bucket, key and ids of the document's bytes, from the BFF's scoped lookup."""
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH, timeout=10.0, query={"collection": collection, "filename": file_name}, headers=headers
        )
    except bff_http.BffRefusedError as exc:
        raise SheetUnavailableError(f"'{file_name}' is not a file this conversation may read.") from exc
    except bff_http.BffError as exc:
        raise SheetUnavailableError("The document service could not be reached; try again shortly.") from exc
    body = body if isinstance(body, dict) else {}
    key = body.get("storageKey")
    if not isinstance(key, str) or not key:
        raise SheetUnavailableError(f"'{file_name}' has no stored file yet.")

    def text(name: str) -> str | None:
        value = body.get(name)
        return value if isinstance(value, str) and value else None

    return _Located(text("storageBucket") or seaweed_s3.default_bucket(), key, text("documentId"), text("versionId"))


_TOO_LARGE = "The PDF is larger than 150 MB; ask for the sheet in question as its own file."


def _read(bucket: str, key: str) -> bytes:
    client = seaweed_s3.s3_client()
    if client is None:
        raise SheetUnavailableError("This deployment cannot read stored files (no object-store credential).")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
        if int(head.get("ContentLength") or 0) > MAX_PDF_BYTES:
            raise SheetUnavailableError(_TOO_LARGE)
        # Bounded even when the store states no length: never more than one byte past the limit.
        data = client.get_object(Bucket=bucket, Key=key)["Body"].read(MAX_PDF_BYTES + 1)
    except SheetUnavailableError:
        raise
    except Exception as exc:  # noqa: BLE001 - any store fault is one sentence to the model
        raise SheetUnavailableError("The stored PDF could not be read; try again shortly.") from exc
    if len(data) > MAX_PDF_BYTES:
        raise SheetUnavailableError(_TOO_LARGE)
    return data


def clear_cache() -> None:
    """Forget every cached sheet and file (tests)."""
    with _LOCK:
        _SHEETS.clear()
        _BYTES.clear()
        _READING.clear()
