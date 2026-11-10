"""One page of a configured source, captured for a citation (ADR-0170).

An operator's agent onboarding a country cites pages. The BFF stores what a
citation is checked against, and asks for the page here, on the api tier,
because only the backend roles may call the sandboxed fetcher (ADR-0162): the
request goes through :func:`public_sources.routing.source_transport`, so the
source's hosts are checked at every redirect hop and the address is public,
exactly as for every other read of the source.

Answers the bytes' sha256 and size, where the fetch ended, and the page's text
for the quote check. The text is what a person reads on the page: markup,
scripts and styles dropped, block boundaries kept as line breaks. A body the
reader cannot read as text (a PDF, an image) has no text; the caller says so.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime

import httpx
from lxml import html as lxml_html
from public_sources.egress import MAX_BODY_BYTES
from public_sources.routing import source_transport
from public_sources.source import Source
from public_sources.source import get_source

#: What a capture asks for: a page a person reads, text before anything else.
ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"

#: The most text a capture keeps; the BFF's column holds the same (0209).
MAX_TEXT_CHARS = 2_000_000

_TEXT_TYPES = ("text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/plain")
_DROPPED = ("script", "style", "noscript", "template", "head")
#: Elements that end a line where a browser would, so their words do not run into the next block's.
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
    """The body as text: the charset the header names, else UTF-8 (what every source here serves)."""
    match = _CHARSET.search(content_type or "")
    charset = match.group(1) if match else "utf-8"
    try:
        return content.decode(charset, errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


class CaptureError(Exception):
    """The page could not be captured; ``status`` is what the route answers."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class CapturedPage:
    url: str
    final_url: str
    content_type: str | None
    sha256: str
    size: int
    text: str | None
    retrieved_at: str


def page_text(content: bytes, content_type: str | None) -> str | None:
    """What a person reads on the page, or ``None`` when the bytes are no text."""
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    if kind not in _TEXT_TYPES:
        return None
    text = _decoded(content, content_type)
    if kind == "text/plain":
        return text[:MAX_TEXT_CHARS]
    # An XML declaration names an encoding lxml refuses on an already decoded string.
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
    """The body, refused past the egress ceiling rather than read whole."""
    if response.status_code >= 400:
        raise CaptureError(f"the source answered HTTP {response.status_code}", 502)
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise CaptureError(f"the page is larger than {MAX_BODY_BYTES} bytes", 502)
        chunks.append(chunk)
    return b"".join(chunks)


async def capture_page(
    source_id: str | Source,
    url: str,
    *,
    inner: httpx.AsyncBaseTransport | None = None,
    credential: str | None = None,
) -> CapturedPage:
    """GET ``url`` as the source allows it: a repository record's id, or a configured source (ADR-0174).

    ``inner`` stands in for the network in tests only.
    """
    source = get_source(source_id) if isinstance(source_id, str) else source_id
    if not source.allows(url):
        hosts = ", ".join(source.hosts)
        raise CaptureError(f"{url} is not an https URL on a host of source {source.id} ({hosts})", 403)
    transport = source_transport(
        source_id if isinstance(source_id, str) else source, inner=inner, credential=credential
    )
    client = httpx.AsyncClient(transport=transport, follow_redirects=True, timeout=45.0, trust_env=False)
    async with client, client.stream("GET", url, headers={"Accept": ACCEPT}) as response:
        content = await _read_capped(response)
        content_type = response.headers.get("content-type")
        final_url = str(response.url)
    return CapturedPage(
        url=url,
        final_url=final_url,
        content_type=content_type,
        sha256=hashlib.sha256(content).hexdigest(),
        size=len(content),
        text=page_text(content, content_type),
        retrieved_at=datetime.now(UTC).isoformat(),
    )
