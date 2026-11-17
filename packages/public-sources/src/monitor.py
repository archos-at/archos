"""A source's monitor: has it changed since the last check? (design 4.2, ADR-0174)

Deterministic, no model call. The record's ``monitor.probe`` names one
operation of its access type; the probe runs it through the same guarded
transport every read uses and compares what came back with what the last check
saw, by the record's ``monitor.kind``:

* ``sha256``: the bytes;
* ``etag``: the validator the server states (and a 304 is "unchanged");
* ``version``: the version the protocol or the engine states (an ELI point in
  time, a consolidation date).

It also hashes the terms page when that page lies on one of the source's hosts
(a terms page elsewhere is a host the source may not reach, so it is reported
unwatched rather than fetched).

What a monitor does with a change (open a change request, never publish) is the
BFF's: this module only answers what it saw.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from dataclasses import field

import httpx
from public_sources.access import access_for
from public_sources.capture import FETCH_TIMEOUT_SECONDS
from public_sources.capture import MAX_TEXT_CHARS
from public_sources.capture import page_text
from public_sources.engines import engine_for
from public_sources.engines.pdf_document import PdfDocument
from public_sources.pdf import PdfError
from public_sources.pdf import is_pdf
from public_sources.pdf import read_pdf
from public_sources.routing import source_transport
from public_sources.source import Source


class MonitorError(Exception):
    """The source cannot be watched (no probe, or ``kind: none``)."""


@dataclass(frozen=True)
class Seen:
    """What one check saw; any field may be empty when the protocol does not state it."""

    etag: str = ""
    sha256: str = ""
    version: str = ""
    terms_sha256: str = ""


@dataclass(frozen=True)
class ProbeResult:
    changed: bool
    terms_changed: bool
    current: Seen
    url: str
    content_type: str
    #: The page's text, for the change request's capture; ``None`` for bytes that are no text.
    text: str | None
    size: int
    #: Why the terms page was not checked, when it was not.
    terms_unwatched: str = ""
    anchors: tuple[str, ...] = field(default_factory=tuple)


def _parsed(source: Source, fetched):
    """The engine's reading of the body, or ``None`` when it cannot read it (it then states no version, no anchors)."""
    try:
        return engine_for(source).document(fetched.body, url=fetched.url)
    except Exception:  # noqa: BLE001 - a body the engine cannot read is still a body whose bytes changed
        return None


def _changed(kind: str, previous: Seen, current: Seen, status: int) -> bool:
    """First check (nothing seen yet) is no change: it is the baseline."""
    if kind == "etag":
        return status != 304 and bool(previous.etag) and current.etag != previous.etag
    if kind == "version":
        return bool(previous.version) and current.version != previous.version
    return bool(previous.sha256) and current.sha256 != previous.sha256


async def _terms_hash(source: Source, client: httpx.AsyncClient) -> tuple[str, str]:
    if not source.allows(source.terms.url):
        return "", "the terms page is not on one of the source's hosts"
    response = await client.get(source.terms.url)
    if response.status_code >= 400:
        return "", f"the terms page answered HTTP {response.status_code}"
    return hashlib.sha256(response.content).hexdigest(), ""


def _read(source: Source, fetched):
    """``(document, text)``: what the engine reads and what a reviewer reads, a PDF parsed once for both.

    Blocking (a PDF is read in a child process): the probe runs it off the event loop.
    """
    if not is_pdf(fetched.body, fetched.content_type):
        return _parsed(source, fetched), _text_of(fetched)
    try:
        read = read_pdf(fetched.body)
    except PdfError:  # the change is still reported, by its bytes; the reviewer opens the document
        return None, None
    engine = engine_for(source)
    document = engine.document_from(read, url=fetched.url) if isinstance(engine, PdfDocument) else None
    return document, read.text


def _text_of(fetched) -> str | None:
    """What a reviewer reads: the page's text, or a JSON body as it came (features, a collection)."""
    text = page_text(fetched.body, fetched.content_type)
    if text is None and "json" in fetched.content_type.lower():
        return fetched.body.decode("utf-8", errors="replace")[:MAX_TEXT_CHARS]
    return text


async def probe(
    source: Source,
    previous: Seen,
    *,
    inner: httpx.AsyncBaseTransport | None = None,
    credential: str | None = None,
) -> ProbeResult:
    """Run the source's probe once and compare it with ``previous``. ``inner`` stands in for the network in tests."""
    if source.monitor.kind == "none" or source.monitor.probe is None:
        raise MonitorError(f"source {source.id!r} is not watched: its monitor names no probe")
    args = dict(source.monitor.probe.args)
    if source.monitor.kind == "etag" and previous.etag:
        args["etag"] = previous.etag
    transport = source_transport(source, inner=inner, credential=credential)
    async with httpx.AsyncClient(
        transport=transport, follow_redirects=True, timeout=FETCH_TIMEOUT_SECONDS, trust_env=False
    ) as client:
        fetched = await access_for(source).fetch(client, source.monitor.probe.operation, args)
        terms_sha256, terms_unwatched = await _terms_hash(source, client)
    unchanged_304 = fetched.status == 304
    # Off the event loop: an engine may parse for seconds (a PDF is read in a child process).
    document, text = (None, None) if unchanged_304 else await asyncio.to_thread(_read, source, fetched)
    current = Seen(
        etag=fetched.etag or (previous.etag if unchanged_304 else ""),
        sha256=previous.sha256 if unchanged_304 else fetched.sha256,
        version=previous.version if unchanged_304 else (fetched.version or (document.version if document else "")),
        terms_sha256=terms_sha256,
    )
    anchors = tuple(p.anchor for p in document.passages) if document else ()
    return ProbeResult(
        changed=_changed(source.monitor.kind, previous, current, fetched.status),
        terms_changed=bool(previous.terms_sha256) and bool(terms_sha256) and terms_sha256 != previous.terms_sha256,
        current=current,
        url=fetched.url,
        content_type=fetched.content_type,
        text=text,
        size=len(fetched.body),
        terms_unwatched=terms_unwatched,
        anchors=anchors,
    )
