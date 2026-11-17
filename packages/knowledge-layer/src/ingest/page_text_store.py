from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from typing import Any

from agent.common.connect_retry import connect_retrying_client

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
SOURCES = ("text_layer", "ocr", "vlm_reading")

_FRONTEND_INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
_INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
_PRESIGN_PATH = "/api/internal/document-text-upload-url"
_HTTP_TIMEOUT_SECONDS = 15.0

PAGES_PART = "pages.md"
INDEX_PART = "index.json"


@dataclass(frozen=True)
class Slot:

    upload_url: str
    document_id: str
    version: int | None
    content_hash: str | None
    storage_key: str | None = None
    storage_bucket: str | None = None


Presigner = Callable[[str, str, str, str | None], Slot | None]
Uploader = Callable[[str, bytes, str], None]


@dataclass(frozen=True)
class PageText:

    page: int
    text: str
    source: str = "text_layer"
    model: str | None = None
    label: str | None = None


def strip_furniture(pages: list[PageText]) -> tuple[list[PageText], bool]:
    from agent.common.page_text import running_furniture
    from agent.common.page_text import without_furniture

    lines = [page.text.splitlines() for page in pages]
    furniture = running_furniture(lines)
    if not furniture:
        return pages, False
    stripped = [
        PageText(p.page, "\n".join(without_furniture(text, furniture)), p.source, p.model, p.label)
        for p, text in zip(pages, lines, strict=True)
    ]
    return stripped, True


def render(
    pages: Iterable[PageText],
    *,
    page_count: int,
    failed_pages: Iterable[int],
    document_id: str,
    version: int | None,
    content_hash: str | None,
    reader_version: str,
    furniture_stripped: bool,
    created_at: str | None = None,
) -> tuple[bytes, dict[str, Any]]:
    by_page = {page.page: page for page in pages if 1 <= page.page <= page_count}
    failed = sorted({int(n) for n in failed_pages if 1 <= int(n) <= page_count})
    body = bytearray()
    entries: list[dict[str, Any]] = []
    for number in range(1, page_count + 1):
        page = by_page.get(number)
        body += f"<!-- page {number} -->\n".encode()
        text = "" if page is None or number in failed else page.text.strip()
        encoded = (text + "\n").encode("utf-8") if text else b""
        entries.append(
            {
                "page": number,
                "label": page.label if page is not None else None,
                "offset": len(body),
                "length": len(encoded),
                "lines": text.count("\n") + 1 if text else 0,
                "source": page.source if page is not None and page.source in SOURCES else "text_layer",
                "model": page.model if page is not None else None,
            }
        )
        body += encoded
    index = {
        "schema_version": SCHEMA_VERSION,
        "file": {
            "document_id": document_id,
            "version": version,
            "content_hash": content_hash,
            "reader_version": reader_version,
            "page_count": page_count,
            "failed_pages": failed,
            "furniture_stripped": furniture_stripped,
            "created_at": created_at or datetime.now(UTC).isoformat(timespec="seconds"),
        },
        "pages": entries,
    }
    return bytes(body), index


def request_slot(document_id: str, collection: str, part: str, organization_id: str | None = None) -> Slot | None:
    base_url = os.environ.get(_FRONTEND_INTERNAL_URL_ENV, "").strip()
    token = os.environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not base_url or not token:
        return None
    try:
        body: dict[str, Any] = {"documentId": document_id, "collection": collection, "part": part}
        if organization_id:
            body["organizationId"] = organization_id
        with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{base_url.rstrip('/')}{_PRESIGN_PATH}",
                json=body,
                headers={"x-internal-token": token},
            )
        if response.status_code != 200:
            logger.info(
                "page_text_store: no slot for %s of document %s (HTTP %d)", part, document_id, response.status_code
            )
            return None
        data = response.json()
        upload_url = data.get("uploadUrl")
        if not isinstance(upload_url, str) or not upload_url:
            return None
        version = data.get("version")
        return Slot(
            upload_url=upload_url,
            document_id=str(data.get("documentId") or document_id),
            version=version if isinstance(version, int) else None,
            content_hash=data.get("contentHash") if isinstance(data.get("contentHash"), str) else None,
            storage_key=data.get("storageKey") if isinstance(data.get("storageKey"), str) else None,
            storage_bucket=data.get("storageBucket") if isinstance(data.get("storageBucket"), str) else None,
        )
    except Exception as e:  # noqa: BLE001 - fail-open contract
        logger.warning("page_text_store: presign failed for document %s: %s", document_id, type(e).__name__)
        return None


def put_part(upload_url: str, body: bytes, content_type: str) -> None:
    with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
        response = client.put(upload_url, content=body, headers={"Content-Type": content_type})
    response.raise_for_status()


def store_page_text(
    pages: list[PageText],
    *,
    page_count: int,
    failed_pages: Iterable[int],
    document_id: str,
    collection: str,
    organization_id: str | None = None,
    presign: Presigner | None = None,
    upload: Uploader | None = None,
) -> bool:
    from knowledge_layer.ingest.reader_version import INGEST_READER_VERSION

    presign = presign or request_slot
    upload = upload or put_part
    if page_count <= 0:
        return False
    try:
        pages_slot = presign(document_id, collection, PAGES_PART, organization_id)
        index_slot = presign(document_id, collection, INDEX_PART, organization_id) if pages_slot else None
        if pages_slot is None or index_slot is None:
            return False
        stripped, furniture = strip_furniture(pages)
        body, index = render(
            stripped,
            page_count=page_count,
            failed_pages=failed_pages,
            document_id=pages_slot.document_id,
            version=pages_slot.version,
            content_hash=pages_slot.content_hash,
            reader_version=INGEST_READER_VERSION,
            furniture_stripped=furniture,
        )
        upload(pages_slot.upload_url, body, "text/markdown; charset=utf-8")
        upload(index_slot.upload_url, json.dumps(index, ensure_ascii=False).encode("utf-8"), "application/json")
        return True
    except Exception as e:  # noqa: BLE001 - fail-open contract
        logger.warning("page_text_store: storing the page text of %s failed (%s)", document_id, type(e).__name__)
        return False


def pdf_pages(
    text_pages: Iterable[Mapping[str, Any]],
    *,
    transcribed: Mapping[int, str],
    ocr_model: str | None,
    drawings: Iterable[Mapping[str, Any]],
    vision_model: str | None,
    tables: Iterable[Mapping[str, Any]] = (),
) -> list[PageText]:
    text: dict[int, str] = {}
    for page in text_pages:
        number = page.get("page_number")
        if isinstance(number, int) and number > 0:
            text[number] = str(page.get("text") or "").strip()
    sources: dict[int, tuple[str, str | None]] = {number: ("ocr", ocr_model) for number in transcribed}
    for drawing in drawings:
        number = drawing.get("page_number")
        reading = str(drawing.get("caption") or "").strip()
        if isinstance(number, int) and number > 0 and reading:
            text[number] = f"{text.get(number, '')}\n\n{reading}".strip()
            sources[number] = ("vlm_reading", vision_model)
    for table in tables:
        number = table.get("page_number")
        body = str(table.get("table_text") or "").strip()
        if isinstance(number, int) and number > 0 and body:
            text[number] = f"{text.get(number, '')}\n\n{body}".strip()
    return [PageText(number, body, *sources.get(number, ("text_layer", None))) for number, body in sorted(text.items())]
