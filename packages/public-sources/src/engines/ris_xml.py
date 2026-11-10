"""``ris_xml``: the OGD-RIS search payload and RIS document pages.

The format of Austria's Rechtsinformationssystem, read once here and configured
per source: the search answer is JSON converted from the XML response schemas
(``OGD_*_Response.xsd``), so element cardinality is ambiguous (a node holding
one child is a dict, the same node with several is a list) and every read goes
through the shape-tolerant helpers below. Document pages are HTML whose
``#content`` holds the law and whose ``.sr-only`` twins repeat it for screen
readers; both selectors are the source's configuration, not constants.

Moved here from ``ris_adapter.client`` (ADR-0158), which re-exports every name,
so the RIS tools read and cite exactly as before.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field
from html import unescape
from typing import Any

from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage


class RisXmlConfig(EngineConfig):
    #: The page element that holds the document and nothing else; absent, the whole page.
    content_selector: str = "#content"
    #: Elements dropped before reading (CSS, as BeautifulSoup selects them).
    drop_selectors: tuple[str, ...] = (".sr-only",)
    #: A host the API states in URLs that the public site serves under another name.
    #: Each pair is ``[from_prefix, to_prefix]``.
    host_rewrites: tuple[tuple[str, str], ...] = ()


class RisError(Exception):
    """Raised for OGD-RIS API errors (validation errors, bad pages, HTTP failures)."""


@dataclass
class RisHit:
    """A single normalized document reference from an OGD-RIS search result."""

    application: str = ""
    document_number: str = ""
    title: str = ""
    citation_url: str = ""  # citizen-application URL of the document (for citations)
    content_urls: dict[str, str] = field(default_factory=dict)  # DataType (Html/Xml/Pdf/Rtf) -> URL
    full_law_url: str = ""  # GesamteRechtsvorschriftUrl — the ENTIRE consolidated law as HTML
    metadata: dict[str, str] = field(default_factory=dict)  # human-relevant fields (dates, §, court, ...)

    @property
    def fetch_url(self) -> str:
        """Best URL for fetching the document text (HTML preferred, then XML)."""
        return self.content_urls.get("Html") or self.citation_url or self.content_urls.get("Xml", "")


@dataclass
class RisSearchResult:
    """Normalized OGD-RIS search response."""

    hits: list[RisHit] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


@dataclass
class RisDocument:
    """A fetched RIS document converted to plain text."""

    url: str
    title: str
    text: str


# ---------------------------------------------------------------------------
# JSON traversal helpers (XML-derived JSON has dict-or-list ambiguity)
# ---------------------------------------------------------------------------


def _as_list(node: Any) -> list[Any]:
    """Normalize an XML-derived JSON node to a list (single child -> dict)."""
    if node is None:
        return []
    if isinstance(node, list):
        return node
    return [node]


def _find_first(node: Any, key: str) -> Any:
    """Breadth-first search for the first value under ``key`` anywhere in ``node``."""
    queue = [node]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            if key in current:
                return current[key]
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)
    return None


def _find_all(node: Any, key: str) -> list[Any]:
    """Breadth-first search for every value under ``key`` anywhere in ``node``."""
    found: list[Any] = []
    queue = [node]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            if key in current:
                found.append(current[key])
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)
    return found


def _as_text(value: Any) -> str:
    """Flatten a scalar / ``{"#text": ...}`` / list node into a display string."""
    if value is None:
        return ""
    if isinstance(value, dict):
        if "#text" in value:
            return _as_text(value["#text"])
        # e.g. Geschaeftszahl arrays come as {"item": [...]}
        return ", ".join(filter(None, (_as_text(v) for v in value.values())))
    if isinstance(value, list):
        return ", ".join(filter(None, (_as_text(v) for v in value)))
    return str(value).strip()


# Metadata fields worth surfacing to the agent, in display order.
_METADATA_FIELDS = (
    ("Kurztitel", "Kurztitel"),
    ("ArtikelParagraphAnlage", "Paragraph/Artikel"),
    ("Gesetzesnummer", "Gesetzesnummer"),
    ("Kundmachungsorgan", "Kundmachungsorgan"),
    ("Inkrafttretensdatum", "In Kraft seit"),
    ("Ausserkrafttretensdatum", "Außer Kraft seit"),
    ("Geschaeftszahl", "Geschäftszahl"),
    ("Entscheidungsdatum", "Entscheidungsdatum"),
    ("Gericht", "Gericht"),
    ("Bundesland", "Bundesland"),
    ("Bgblnummer", "BGBl-Nummer"),
)

_TITLE_KEYS = ("Kurztitel", "Titel", "Dokumenttitel", "Kurzinformation", "Geschaeftszahl")


def public_host(url: str, rewrites: tuple[tuple[str, str], ...] = ()) -> str:
    """A URL on the public host the citations, the catalog and the fetch use.

    OGD-RIS started stating ``ogd.ris.bka.gv.at`` for document and whole-law
    URLs in 2026-09. It answers with a 301 to ``ris.bka.gv.at``, is on no
    allow-list, and written into the norm catalog it replaced every pointer the
    reader can open; the source's ``host_rewrites`` name the pair.
    """
    for old, new in rewrites:
        if url.startswith(old):
            return new + url[len(old) :]
    return url


def _parse_hit(ref: Any, rewrites: tuple[tuple[str, str], ...] = ()) -> RisHit:
    """Normalize one OgdDocumentReference node into a RisHit."""
    hit = RisHit()

    data = ref.get("Data", ref) if isinstance(ref, dict) else ref
    metadaten = _find_first(data, "Metadaten") or data

    technisch = _find_first(metadaten, "Technisch") or {}
    hit.document_number = _as_text(technisch.get("ID") if isinstance(technisch, dict) else None) or _as_text(
        _find_first(metadaten, "Dokumentnummer")
    )
    hit.application = _as_text(technisch.get("Applikation") if isinstance(technisch, dict) else None)

    for key in _TITLE_KEYS:
        title = _as_text(_find_first(metadaten, key))
        if title:
            hit.title = title
            break

    hit.citation_url = public_host(_as_text(_find_first(metadaten, "DokumentUrl")), rewrites)
    hit.full_law_url = public_host(_as_text(_find_first(metadaten, "GesamteRechtsvorschriftUrl")), rewrites)

    for key, label in _METADATA_FIELDS:
        value = _as_text(_find_first(metadaten, key))
        if value and label not in hit.metadata:
            hit.metadata[label] = value

    # Content URLs live under Dokumentliste/ContentReference/Urls/ContentUrl.
    for content_url in _find_all(ref, "ContentUrl"):
        for entry in _as_list(content_url):
            if not isinstance(entry, dict):
                continue
            data_type = _as_text(entry.get("DataType"))
            url = _as_text(entry.get("Url"))
            if data_type and url and data_type not in hit.content_urls:
                hit.content_urls[data_type] = url

    return hit


def parse_search_response(payload: dict[str, Any], rewrites: tuple[tuple[str, str], ...] = ()) -> RisSearchResult:
    """Parse a raw OGD-RIS JSON response into a RisSearchResult.

    Raises:
        RisError: When the payload carries an ``OgdSearchResult.Error`` node.
    """
    result = payload.get("OgdSearchResult")
    if not isinstance(result, dict):
        raise RisError("Unexpected OGD-RIS response: missing OgdSearchResult")

    error = result.get("Error")
    if isinstance(error, dict):
        application = _as_text(error.get("Applikation"))
        message = _as_text(error.get("Message")) or "unknown error"
        raise RisError(f"OGD-RIS API error ({application or 'unknown application'}): {message}")

    doc_results = result.get("OgdDocumentResults") or {}
    hits_node = doc_results.get("Hits")
    total = 0
    page = 1
    page_size = 20
    if isinstance(hits_node, dict):
        total = int(_as_text(hits_node.get("#text")) or 0)
        page = int(_as_text(hits_node.get("@pageNumber")) or 1)
        page_size = int(_as_text(hits_node.get("@pageSize")) or 20)
    elif hits_node is not None:
        total = int(_as_text(hits_node) or 0)

    hits = [_parse_hit(ref, rewrites) for ref in _as_list(doc_results.get("OgdDocumentReference"))]
    return RisSearchResult(hits=hits, total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# HTML / XML -> plain text
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


#: Why ``content_selector`` is ``#content`` for RIS:
#:
#: Measured against ``GeltendeFassung.wxe`` for the Bauordnung für Wien
#: (2026-09-04): the page is 759,687 characters of extracted text and ``#content``
#: holds 759,015 of them. The 672 characters outside it are the site's own
#: furniture — an accesskey menu ("Zum Inhalt (Accesskey 0)"), the navigation
#: bar, the footer — and they sit at the FRONT, which is where they do the most
#: damage: they are the first thing the in-app reader shows, the first thing the
#: agent reads inside its ``max_chars`` window, and they are ingested into the
#: session collection where they become retrievable text that is not law.
#:
#: Absence is not an error. A ``/Dokumente/…`` document page, an XML payload, or
#: a future RIS template may carry no such container, and then the whole document
#: is the answer exactly as it was before.


def html_to_text(
    markup: str, content_selector: str = "#content", drop_selectors: tuple[str, ...] = (".sr-only",)
) -> tuple[str, str]:
    """Convert an HTML/XML document to (title, plain text).

    Uses BeautifulSoup when available; falls back to a regex tag stripper so
    the adapter degrades gracefully rather than failing the whole tool call.

    The RIS page's own navigation is dropped when the document container can be
    found (``content_selector``); everything else is kept verbatim,
    because this text is what a legal answer is grounded on and what a reader
    checks it against.
    """
    title = ""
    title_match = _TITLE_RE.search(markup)
    if title_match:
        title = unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(markup, "html.parser")
        for tag in soup(["script", "style", "noscript", "head"]):
            tag.decompose()
        # RIS states every marker twice: ``a)`` for the eye (aria-hidden) and
        # ``Litera a`` for a screen reader (.sr-only), and every citation again
        # spelled out ("Paragraph 118, Absatz eins"). Kept, the spoken twin was
        # a third of the Bauordnung für Wien and half of some §§, and it pushed
        # the provision itself out of the passage the agent reads.
        for tag in [tag for selector in drop_selectors for tag in soup.select(selector)]:
            tag.decompose()
        root = (soup.select_one(content_selector) if content_selector else None) or soup
        text = root.get_text("\n")
    except ImportError:  # pragma: no cover - bs4 is a declared dependency
        text = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", markup)
        text = unescape(re.sub(r"<[^>]+>", "\n", text))

    # Collapse intra-line whitespace and runs of blank lines.
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    collapsed: list[str] = []
    for line in lines:
        if line:
            collapsed.append(line)
        elif collapsed and collapsed[-1] != "":
            collapsed.append("")
    return title, "\n".join(collapsed).strip()


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class RisXml(Engine):
    """The engine object a source record configures; the functions above with its values."""

    name = "ris_xml"
    config_model = RisXmlConfig

    def public_host(self, url: str) -> str:
        return public_host(url, self.config.host_rewrites)

    def search(self, payload: dict[str, Any]) -> RisSearchResult:
        return parse_search_response(payload, self.config.host_rewrites)

    def text(self, markup: str) -> tuple[str, str]:
        return html_to_text(markup, self.config.content_selector, self.config.drop_selectors)

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        """A RIS page as one passage: the § grammar lives in ``ris_adapter.lookup.grammar``."""
        title, text = self.text(body.decode("utf-8", errors="replace"))
        return ParsedDocument(title=title, uri=self.public_host(url), passages=(Passage("", "", title, text),))
