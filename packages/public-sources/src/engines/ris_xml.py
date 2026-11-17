from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field
from html import unescape
from typing import Any

from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage


class RisXmlConfig(EngineConfig):
    content_selector: str = "#content"
    drop_selectors: tuple[str, ...] = (".sr-only",)
    host_rewrites: tuple[tuple[str, str], ...] = ()


class RisError(EngineError):
    ...


@dataclass
class RisHit:

    application: str = ""
    document_number: str = ""
    title: str = ""
    citation_url: str = ""  # citizen-application URL of the document (for citations)
    content_urls: dict[str, str] = field(default_factory=dict)  # DataType (Html/Xml/Pdf/Rtf) -> URL
    full_law_url: str = ""  # GesamteRechtsvorschriftUrl — the ENTIRE consolidated law as HTML
    metadata: dict[str, str] = field(default_factory=dict)  # human-relevant fields (dates, §, court, ...)

    @property
    def fetch_url(self) -> str:
        return self.content_urls.get("Html") or self.citation_url or self.content_urls.get("Xml", "")


@dataclass
class RisSearchResult:

    hits: list[RisHit] = field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


@dataclass
class RisDocument:

    url: str
    title: str
    text: str




def _as_list(node: Any) -> list[Any]:
    if node is None:
        return []
    if isinstance(node, list):
        return node
    return [node]


def _find_first(node: Any, key: str) -> Any:
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
    if value is None:
        return ""
    if isinstance(value, dict):
        if "#text" in value:
            return _as_text(value["#text"])
        return ", ".join(filter(None, (_as_text(v) for v in value.values())))
    if isinstance(value, list):
        return ", ".join(filter(None, (_as_text(v) for v in value)))
    return str(value).strip()


IN_FORCE_UNTIL = "In Kraft bis"
IN_FORCE_FROM = "In Kraft seit"
TERRITORY_FIELD = "Bundesland"
PROVISION_FIELD = "Paragraph/Artikel"

_METADATA_FIELDS = (
    ("Kurztitel", "Kurztitel"),
    ("ArtikelParagraphAnlage", PROVISION_FIELD),
    ("Gesetzesnummer", "Gesetzesnummer"),
    ("Kundmachungsorgan", "Kundmachungsorgan"),
    ("Inkrafttretensdatum", IN_FORCE_FROM),
    ("Ausserkrafttretensdatum", IN_FORCE_UNTIL),
    ("Geschaeftszahl", "Geschäftszahl"),
    ("Entscheidungsdatum", "Entscheidungsdatum"),
    ("Gericht", "Gericht"),
    ("Bundesland", TERRITORY_FIELD),
    ("Bgblnummer", "BGBl-Nummer"),
)

_TITLE_KEYS = ("Kurztitel", "Titel", "Dokumenttitel", "Kurzinformation", "Geschaeftszahl")


# OGD-RIS started stating ogd.ris.bka.gv.at in URLs in 2026-09; it answers 301 to ris.bka.gv.at and is on no allow-list.
def public_host(url: str, rewrites: tuple[tuple[str, str], ...] = ()) -> str:
    for old, new in rewrites:
        if url.startswith(old):
            return new + url[len(old) :]
    return url


def _parse_hit(ref: Any, rewrites: tuple[tuple[str, str], ...] = ()) -> RisHit:
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



_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)




# #content holds 759,015 of 759,687 characters of a Bauordnung für Wien page (2026-09-04); the rest is site furniture.
def html_to_text(
    markup: str, content_selector: str = "#content", drop_selectors: tuple[str, ...] = (".sr-only",)
) -> tuple[str, str]:
    title = ""
    title_match = _TITLE_RE.search(markup)
    if title_match:
        title = unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(markup, "html.parser")
        for tag in soup(["script", "style", "noscript", "head"]):
            tag.decompose()
        for tag in [tag for selector in drop_selectors for tag in soup.select(selector)]:
            tag.decompose()
        root = (soup.select_one(content_selector) if content_selector else None) or soup
        text = root.get_text("\n")
    except ImportError:  # pragma: no cover - bs4 is a declared dependency
        text = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", markup)
        text = unescape(re.sub(r"<[^>]+>", "\n", text))

    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    collapsed: list[str] = []
    for line in lines:
        if line:
            collapsed.append(line)
        elif collapsed and collapsed[-1] != "":
            collapsed.append("")
    return title, "\n".join(collapsed).strip()




class RisXml(Engine):

    name = "ris_xml"
    config_model = RisXmlConfig
    in_force_from = IN_FORCE_FROM
    in_force_until = IN_FORCE_UNTIL
    territory_field = TERRITORY_FIELD
    provision_field = PROVISION_FIELD

    def public_host(self, url: str) -> str:
        return public_host(url, self.config.host_rewrites)

    def search(self, payload: dict[str, Any]) -> RisSearchResult:
        return parse_search_response(payload, self.config.host_rewrites)

    def text(self, markup: str) -> tuple[str, str]:
        return html_to_text(markup, self.config.content_selector, self.config.drop_selectors)

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        title, text = self.text(body.decode("utf-8", errors="replace"))
        return ParsedDocument(title=title, uri=self.public_host(url), passages=(Passage("", "", title, text),))
