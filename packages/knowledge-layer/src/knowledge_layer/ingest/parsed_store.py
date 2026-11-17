from __future__ import annotations

import contextlib
import contextvars
import dataclasses
import hashlib
import json
import logging
from collections.abc import Callable
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from knowledge_layer.env import env_int

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
PARSED_PART = "parsed.json"

PARSED_MAX_BYTES = env_int("INGEST_PARSED_MAX_BYTES", 32 * 1024 * 1024, minimum=0)

_PASS_MODULES = ("adapter.py", "captioned_tables.py", "section_chunking.py", "page_triage.py", "parsed_store.py")


def _pipeline_version() -> str:
    from knowledge_layer.ingest.reader_version import INGEST_READER_VERSION

    from . import adapter

    digest = hashlib.sha256(f"{SCHEMA_VERSION}|{INGEST_READER_VERSION}".encode())
    thresholds = (adapter.VISUAL_PAGE_MIN_TEXT_CHARS, adapter.VISUAL_PAGE_MIN_PATHS, adapter.PDF_PAGE_MAX_OBJECTS)
    digest.update(repr(thresholds).encode())
    for name in _PASS_MODULES:
        digest.update((Path(__file__).parent / name).read_bytes())
    for package in ("pdfplumber", "pypdfium2"):
        with contextlib.suppress(Exception):
            from importlib.metadata import version

            digest.update(f"{package}={version(package)}".encode())
    return digest.hexdigest()[:32]


_PIPELINE: str | None = None


def pipeline_version() -> str:
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = _pipeline_version()
    return _PIPELINE


def _encode(value: Any) -> Any:
    from .captioned_tables import PageTable

    if isinstance(value, PageTable):
        return {"__page_table": {key: _encode(item) for key, item in dataclasses.asdict(value).items()}}
    if isinstance(value, tuple):
        return {"__tuple": [_encode(item) for item in value]}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _encode(item) for key, item in value.items()}
    return value


def _decode(value: Any) -> Any:
    from .captioned_tables import PageTable

    if isinstance(value, list):
        return [_decode(item) for item in value]
    if not isinstance(value, dict):
        return value
    if "__tuple" in value and len(value) == 1:
        return tuple(_decode(item) for item in value["__tuple"])
    if "__page_table" in value and len(value) == 1:
        return PageTable(**{key: _decode(item) for key, item in value["__page_table"].items()})
    return {key: _decode(item) for key, item in value.items()}


def encode_text_pages(text_pages: Any) -> dict[str, Any]:
    return {
        "pages": _encode(list(text_pages)),
        "failed_pages": list(getattr(text_pages, "failed_pages", [])),
        "page_count": getattr(text_pages, "page_count", 0),
        "dense_pages": list(getattr(text_pages, "dense_pages", [])),
    }


def decode_text_pages(data: dict[str, Any]) -> Any:
    from .adapter import PdfTextPages

    return PdfTextPages(
        _decode(data["pages"]),
        failed_pages=list(data.get("failed_pages") or []),
        page_count=int(data.get("page_count") or 0),
        dense_pages=list(data.get("dense_pages") or []),
    )


def encode_triage(triage: Any) -> dict[str, Any] | None:
    return None if triage is None else {str(number): kind.value for number, kind in triage.kinds.items()}


def decode_triage(data: dict[str, Any] | None) -> Any:
    from .page_triage import PageKind
    from .page_triage import PdfTriage

    return None if data is None else PdfTriage({int(number): PageKind(kind) for number, kind in data.items()})


_UNSET: Any = object()


@dataclasses.dataclass
class ParsedDocument:
    content_hash: str
    text: dict[str, Any] | None = None
    triage: Any = _UNSET
    tables: dict[str, Any] | None = None
    read_back: bool = False
    dirty: bool = False

    def body(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "pipeline": pipeline_version(),
            "content_hash": self.content_hash,
            "text": self.text,
            "triage": None if self.triage is _UNSET else {"kinds": encode_triage(self.triage)},
            "tables": self.tables,
        }

    @classmethod
    def from_body(cls, body: Any, content_hash: str) -> ParsedDocument | None:
        if not isinstance(body, dict) or body.get("schema_version") != SCHEMA_VERSION:
            return None
        if body.get("content_hash") != content_hash or body.get("pipeline") != pipeline_version():
            return None
        triage = body.get("triage")
        return cls(
            content_hash=content_hash,
            text=body.get("text"),
            triage=_UNSET if triage is None else decode_triage(triage.get("kinds")),
            tables=body.get("tables"),
            read_back=True,
        )


Presigner = Callable[[str, str, str, str | None], Any]
Fetcher = Callable[[str | None, str], bytes | None]
Uploader = Callable[[str, bytes, str], None]


def _fetch(bucket: str | None, key: str) -> bytes | None:
    from agent.common import seaweed_s3

    client = seaweed_s3.s3_client()
    if client is None:
        return None
    answer = client.get_object(Bucket=bucket or seaweed_s3.default_bucket(), Key=key)
    return answer["Body"].read(PARSED_MAX_BYTES + 1)


@dataclasses.dataclass
class ParsedStore:
    document_id: str | None
    collection: str
    organization_id: str | None
    presign: Presigner | None = None
    fetch: Fetcher | None = None
    upload: Uploader | None = None

    def _slot(self) -> Any:
        from . import page_text_store

        if not self.document_id or PARSED_MAX_BYTES <= 0:
            return None
        presign = self.presign or page_text_store.request_slot
        return presign(self.document_id, self.collection, PARSED_PART, self.organization_id)

    def load(self, content_hash: str) -> ParsedDocument | None:
        try:
            slot = self._slot()
            if slot is None or not getattr(slot, "storage_key", None):
                return None
            raw = (self.fetch or _fetch)(getattr(slot, "storage_bucket", None), slot.storage_key)
            if raw is None or len(raw) > PARSED_MAX_BYTES:
                return None
            return ParsedDocument.from_body(json.loads(raw), content_hash)
        except Exception as exc:  # noqa: BLE001 - no artefact: the pass runs as before
            logger.info("parsed_store: no parsed document read for %s (%s)", self.document_id, type(exc).__name__)
            return None

    def save(self, parsed: ParsedDocument) -> bool:
        if not parsed.dirty or not self.document_id or PARSED_MAX_BYTES <= 0:
            return False
        from . import page_text_store

        body = json.dumps(parsed.body(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > PARSED_MAX_BYTES:
            logger.warning(
                "parsed_store: not storing the parsed document of %s: %d bytes, over INGEST_PARSED_MAX_BYTES (%d)",
                self.document_id,
                len(body),
                PARSED_MAX_BYTES,
            )
            return False
        try:
            slot = self._slot()
            if slot is None:
                return False
            (self.upload or page_text_store.put_part)(slot.upload_url, body, "application/json")
            parsed.dirty = False
            return True
        except Exception as exc:  # noqa: BLE001 - fail-open: the next attempt parses again
            logger.warning(
                "parsed_store: storing the parsed document of %s failed (%s)", self.document_id, type(exc).__name__
            )
            return False


@dataclasses.dataclass
class FileParse:
    store: ParsedStore | None
    parsed: ParsedDocument | None

    def text_pages(self, pdf_path: str) -> Any:
        from . import adapter

        if self.parsed is not None and self.parsed.text is not None:
            return decode_text_pages(self.parsed.text)
        text_pages = adapter._extract_text_from_pdf(pdf_path)
        if self.parsed is not None:
            self.parsed.text, self.parsed.dirty = encode_text_pages(text_pages), True
        return text_pages

    def triage(self, pdf_path: str, page_texts: dict[int, str], **thresholds: int) -> Any:
        from . import page_triage

        if self.parsed is not None and self.parsed.triage is not _UNSET:
            return self.parsed.triage
        triage = page_triage.triage_pdf(pdf_path, page_texts, **thresholds)
        if self.parsed is not None:
            self.parsed.triage, self.parsed.dirty = triage, True
        return triage

    def tables(self, pdf_path: str, taken: dict[int, list[tuple]], skip: list[int]) -> list[dict[str, Any]]:
        from . import adapter

        held = (self.parsed.tables or {}) if self.parsed is not None else {}
        if held.get("skip") == sorted(skip) and "tables" in held:
            return _decode(held["tables"])
        tables = adapter._extract_tables_from_pdf(pdf_path, taken, skip)
        if self.parsed is not None:
            self.parsed.tables, self.parsed.dirty = {"skip": sorted(skip), "tables": _encode(tables)}, True
        return tables

    def save(self) -> bool:
        if self.store is None or self.parsed is None:
            return False
        return self.store.save(self.parsed)


def open_for(config: dict[str, Any], collection: str, pdf_path: str) -> contextlib.AbstractContextManager[FileParse]:
    from .chunk_identity import file_version

    document_id = config.get("document_id")
    if not document_id or PARSED_MAX_BYTES <= 0:
        return file_parse(None, None)
    store = ParsedStore(str(document_id), collection, config.get("organization_id"))
    return file_parse(store, file_version(pdf_path))


_CURRENT: contextvars.ContextVar[FileParse | None] = contextvars.ContextVar("file_parse", default=None)


def current() -> FileParse:
    return _CURRENT.get() or FileParse(None, None)


@contextlib.contextmanager
def file_parse(store: ParsedStore | None, content_hash: str | None) -> Iterator[FileParse]:
    parsed = None
    if store is not None and content_hash:
        parsed = store.load(content_hash)
        if parsed is not None:
            logger.info(
                "parsed_store: read back the parsed document of %s; the text and table passes are skipped",
                store.document_id,
            )
        else:
            parsed = ParsedDocument(content_hash=content_hash)
    parse = FileParse(store, parsed)
    token = _CURRENT.set(parse)
    try:
        yield parse
    finally:
        _CURRENT.reset(token)
