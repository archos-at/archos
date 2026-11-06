"""``html_statute``: a statute published as an HTML page, into anchored passages.

For the portals that publish law as web pages without a structured format.
The record says where the provisions are, as XPath over the page: the element
that holds one provision, and inside it the number and the heading. The
engine builds an Akoma Ntoso style anchor from the number (``§ 6a`` ->
``para_6a``, ``Art. 16b`` -> ``art_16b``), so a passage from a web page is
cited and compared exactly like one from an AKN file.

lxml's HTML parser, XPath 1.0. No CSS selectors: one selector language in the
records, and no extra dependency for it.
"""

from __future__ import annotations

import re

from lxml import etree
from lxml import html as lxml_html
from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.engines.base import collapse
from pydantic import Field

_ANCHOR_PREFIXES = (("§", "para"), ("art", "art"), ("artikel", "art"), ("section", "sec"), ("rule", "rule"))
_TOKEN_RE = re.compile(r"[0-9]+[a-z]*", re.IGNORECASE)


class HtmlStatuteConfig(EngineConfig):
    #: XPath selecting each provision's container.
    unit: str
    #: XPath, relative to the unit, of the provision's number ("§ 6", "Art. 3").
    number: str
    #: XPath, relative to the unit, of its heading; empty when the page has none.
    heading: str = ""
    #: XPath of the document title; the page ``<title>`` when empty.
    title: str = ""
    #: XPath of elements removed before reading: navigation, footnotes, screen-reader twins.
    drop: tuple[str, ...] = ()
    #: The page's encoding. Stated, not sniffed: lxml reads undeclared bytes as Latin-1.
    encoding: str = "utf-8"
    max_passages: int = Field(default=2000, ge=1)


def anchor_for(number: str) -> str:
    """An AKN-style eId for a provision number: ``§ 6a`` -> ``para_6a``."""
    lowered = number.strip().lower()
    prefix = next((eid for word, eid in _ANCHOR_PREFIXES if lowered.startswith(word)), "prov")
    token = _TOKEN_RE.search(lowered)
    return f"{prefix}_{token.group(0)}" if token else ""


class HtmlStatute(Engine):
    name = "html_statute"
    config_model = HtmlStatuteConfig

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        try:
            root = lxml_html.fromstring(body, parser=lxml_html.HTMLParser(encoding=self.config.encoding))
        except (etree.ParserError, ValueError) as exc:
            raise EngineError(f"not an HTML page: {exc}") from exc
        for path in self.config.drop:
            for element in root.xpath(path):
                element.drop_tree()
        passages: list[Passage] = []
        seen: set[str] = set()
        for unit in root.xpath(self.config.unit)[: self.config.max_passages]:
            passage = self._passage(unit)
            if passage.anchor and passage.anchor not in seen:
                seen.add(passage.anchor)
                passages.append(passage)
        return ParsedDocument(title=self._title(root), uri=url, passages=tuple(passages))

    def _passage(self, unit) -> Passage:
        number = _xpath_text(unit, self.config.number)
        heading = _xpath_text(unit, self.config.heading) if self.config.heading else ""
        text = collapse(unit.text_content())
        for prefix in (number, heading):
            if prefix and text.startswith(prefix):
                text = text[len(prefix) :].lstrip()
        return Passage(anchor=anchor_for(number), number=number, heading=heading, text=text)

    def _title(self, root) -> str:
        if self.config.title:
            return _xpath_text(root, self.config.title)
        found = root.xpath("//title")
        return collapse(found[0].text_content()) if found else ""


def _xpath_text(node, path: str) -> str:
    found = node.xpath(path)
    if not found:
        return ""
    first = found[0]
    value = first if isinstance(first, str) else first.text_content()
    return collapse(str(value)).replace("\n", " ")
