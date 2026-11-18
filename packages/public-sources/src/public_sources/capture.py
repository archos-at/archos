from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import datetime

import httpx
from lxml import html as lxml_html

from public_sources.egress import MAX_BODY_BYTES
from public_sources.egress import EgressRefused
from public_sources.pdf import MAX_TEXT_CHARS
from public_sources.pdf import PdfError
from public_sources.pdf import is_pdf
from public_sources.pdf import read_pdf
from public_sources.routing import source_transport
from public_sources.source import Source
from public_sources.source import get_source

FETCH_TIMEOUT_SECONDS = 45.0

ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/pdf;q=0.8,*/*;q=0.5"


_TEXT_TYPES = ("text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/plain")
_DROPPED = ("script", "style", "noscript", "template", "head")
_BLOCKS = (
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul",
)
_CHARSET = re.compile(r"charset=[\"']?([\w.:-]+)", re.IGNORECASE)


def _decoded(content: bytes, content_type: str | None) -> str:
    match = _CHARSET.search(content_type or "")
    charset = match.group(1) if match else "utf-8"
    try:
        return content.decode(charset, errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


class CaptureError(Exception):
    def __init__(self, message: str, status: int, code: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class CapturedPage:
    url: str
    final_url: str
    content_type: str | None
    sha256: str
    size: int
    text: str | None
    retrieved_at: str
    pages: int | None = None
    note: str = ""
    content: bytes = field(default=b"", repr=False, compare=False)


def page_text(content: bytes, content_type: str | None) -> str | None:
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    if kind not in _TEXT_TYPES:
        return None
    text = _decoded(content, content_type)
    if kind == "text/plain":
        return text[:MAX_TEXT_CHARS]
    text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
    try:
        root = lxml_html.fromstring(text)
    except ValueError, lxml_html.etree.ParserError:
        return None
    for element in list(root.iter(*_DROPPED)):
        element.drop_tree()
    for element in root.iter(*_BLOCKS):
        element.tail = "\n" + (element.tail or "")
    lines = (" ".join(line.split()) for line in root.text_content().splitlines())
    return "\n".join(line for line in lines if line)[:MAX_TEXT_CHARS]


async def _read_capped(response: httpx.Response) -> bytes:
    if response.status_code >= 400:
        raise CaptureError(f"the source answered HTTP {response.status_code}", 502)
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise CaptureError(f"the page is larger than {MAX_BODY_BYTES} bytes", 422, "body_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


async def capture_page(
    source_id: str | Source,
    url: str,
    *,
    inner: httpx.AsyncBaseTransport | None = None,
    credential: str | None = None,
) -> CapturedPage:
    source = get_source(source_id) if isinstance(source_id, str) else source_id
    if not source.allows(url):
        hosts = ", ".join(source.hosts)
        raise CaptureError(
            f"{url} is not an https URL on a host of source {source.id} ({hosts})", 403, "egress_refused"
        )
    transport = source_transport(
        source_id if isinstance(source_id, str) else source, inner=inner, credential=credential
    )
    client = httpx.AsyncClient(
        transport=transport, follow_redirects=True, timeout=FETCH_TIMEOUT_SECONDS, trust_env=False
    )
    try:
        async with client, client.stream("GET", url, headers={"Accept": ACCEPT}) as response:
            content = await _read_capped(response)
            content_type = response.headers.get("content-type")
            final_url = str(response.url)
    except EgressRefused as exc:  # a hop off the hosts, or a name that resolves to no public address
        raise CaptureError(str(exc), 403, "egress_refused") from exc
    text, pages, note = await _text_of(content, content_type)
    return CapturedPage(
        url=url,
        final_url=final_url,
        content_type=content_type,
        sha256=hashlib.sha256(content).hexdigest(),
        size=len(content),
        text=text,
        retrieved_at=datetime.now(UTC).isoformat(),
        pages=pages,
        note=note,
        content=content,
    )


async def _text_of(content: bytes, content_type: str | None) -> tuple[str | None, int | None, str]:
    if not is_pdf(content, content_type):
        return page_text(content, content_type), None, ""
    try:
        document = await asyncio.to_thread(read_pdf, content)
    except PdfError as exc:
        raise CaptureError(str(exc), 422, exc.code) from exc
    return document.text, len(document.pages), document.note
