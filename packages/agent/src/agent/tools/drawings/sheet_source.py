from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from agent import project_context
from agent.common import bff_http
from agent.common import seaweed_s3
from agent.common.stored_file import DOCUMENT_FILE_PATH
from agent.common.stored_file import ambiguous_name_message
from agent.common.stored_file import document_file_query
from agent.common.stored_file import names_several_documents
from agent.drawings.sheet_calibration import from_records
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_types import Sheet
from agent.drawings.sheet_types import sheet_from_plain
from agent.knowledge.restricted_use import note_collections_read

from ..canvas.calls import Refused
from ..look.register import licence_of
from ..look.resolve import Resolved
from ..look.resolve import resolve_document

TOOL = "drawing_measure"

MAX_PDF_BYTES = 150 * 1024 * 1024
CACHE_SEGMENTS = 3_000_000
CACHE_SHEETS = 12
FIGURE_WEIGHT = 8
BYTES_FILES = 2
READ_TIMEOUT_S = 90

_SheetKey = tuple[str, str, int]
_SHEETS: OrderedDict[_SheetKey, Sheet] = OrderedDict()
_BYTES: OrderedDict[tuple[str, str], bytes] = OrderedDict()
_LOCK = threading.Lock()
_READING: dict[_SheetKey, threading.Lock] = {}

NO_ENVELOPE = (
    f"{TOOL} acts for the person in this conversation, and this run carries no signed request context to act "
    "with, so no project file can be read."
)


@dataclass(frozen=True)
class LoadedSheet:
    file_name: str
    page: int
    sheet: Sheet
    collection: str
    document_id: str | None
    version_id: str | None
    calibrations: tuple[Calibration, ...] = ()
    calibrations_unread: int = 0


class SheetUnavailableError(Exception): ...


@dataclass(frozen=True)
class _Located:
    bucket: str
    key: str
    document_id: str | None
    version_id: str | None
    calibrations: tuple[Any, ...] = ()


async def load_sheet(document: str, page: int) -> LoadedSheet | str:
    try:
        resolved = await resolve_document(document)
    except Refused as refused:
        return str(refused)
    if isinstance(resolved, str):
        return resolved
    return await load_resolved_sheet(resolved, page)


async def load_resolved_sheet(resolved: Resolved, page: int) -> LoadedSheet | str:
    if not resolved.collection:
        return f"'{resolved.file_name}' is a base-corpus document, not a drawing of this project."
    if not resolved.file_name.lower().endswith(".pdf"):
        return (
            f"'{resolved.file_name}' is no PDF. {TOOL} reads the pages of a PDF drawing; for a DXF use dxf_measure, "
            "for an IFC model ifc_measure, for an image look."
        )
    licence = await licence_of(resolved)
    if licence is not None and licence.licensed:
        return f"'{resolved.file_name}' is a licensed copy: {TOOL} does not read it. Look at the page instead."
    header, signature = project_context.get_request_envelope_from_context()
    if not (header and signature):
        return NO_ENVELOPE
    headers = bff_http.SignedEnvelope(header=header, signature=signature).headers()
    try:
        located, sheet = await asyncio.wait_for(
            asyncio.to_thread(_sheet, resolved.collection, resolved.file_name, page, headers, resolved.document_id),
            READ_TIMEOUT_S,
        )
    except SheetUnavailableError as exc:
        return str(exc)
    except TimeoutError:
        return f"Page {page} of '{resolved.file_name}' takes too long to read; try again shortly."
    note_collections_read([resolved.collection])
    calibrations, unread = from_records(sheet, located.calibrations)
    return LoadedSheet(
        resolved.file_name,
        page,
        sheet,
        resolved.collection,
        located.document_id,
        located.version_id,
        calibrations,
        unread,
    )


def _sheet(
    collection: str, file_name: str, page: int, headers: dict[str, str], document_id: str | None = None
) -> tuple[_Located, Sheet]:
    located = _locate(collection, file_name, headers, page, document_id)
    key = (located.bucket, located.key, page)
    with _LOCK:
        reading = _READING.setdefault(key, threading.Lock())
    try:
        sheet = _read_once(reading, key, located, file_name)
    finally:
        with _LOCK:
            _READING.pop(key, None)
    return located, sheet


def _read_once(reading: threading.Lock, key: _SheetKey, located: _Located, file_name: str) -> Sheet:
    with reading:
        sheet = _cached(key)
        if sheet is None:
            sheet = _read_sheet(_bytes(located), key[2], file_name)
            _remember(key, sheet)
        return sheet


def _read_sheet(data: bytes, page: int, file_name: str) -> Sheet:
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
    return sum(len(kept.segments) + FIGURE_WEIGHT * len(kept.figures) for kept in _SHEETS.values())


def _bytes(located: _Located) -> bytes:
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


def _locate(
    collection: str, file_name: str, headers: dict[str, str], page: int, document_id: str | None = None
) -> _Located:
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH,
            timeout=10.0,
            query={**document_file_query(collection, file_name, document_id), "calibrationsPage": str(page)},
            headers=headers,
        )
    except bff_http.BffRefusedError as exc:
        if names_several_documents(exc):
            raise SheetUnavailableError(ambiguous_name_message(file_name)) from exc
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

    stored = body.get("calibrations")
    return _Located(
        text("storageBucket") or seaweed_s3.default_bucket(),
        key,
        text("documentId"),
        text("versionId"),
        tuple(stored) if isinstance(stored, list) else (),
    )


_TOO_LARGE = "The PDF is larger than 150 MB; ask for the sheet in question as its own file."


def _read(bucket: str, key: str) -> bytes:
    client = seaweed_s3.s3_client()
    if client is None:
        raise SheetUnavailableError("This deployment cannot read stored files (no object-store credential).")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
        if int(head.get("ContentLength") or 0) > MAX_PDF_BYTES:
            raise SheetUnavailableError(_TOO_LARGE)
        data = client.get_object(Bucket=bucket, Key=key)["Body"].read(MAX_PDF_BYTES + 1)
    except SheetUnavailableError:
        raise
    except Exception as exc:  # noqa: BLE001 - any store fault is one sentence to the model
        raise SheetUnavailableError("The stored PDF could not be read; try again shortly.") from exc
    if len(data) > MAX_PDF_BYTES:
        raise SheetUnavailableError(_TOO_LARGE)
    return data


def clear_cache() -> None:
    with _LOCK:
        _SHEETS.clear()
        _BYTES.clear()
        _READING.clear()
