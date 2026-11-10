"""``akn``: Akoma Ntoso (OASIS LegalDocML 1.0) into anchored passages.

One engine for every publisher of the standard: Fedlex (CH), legislation.gov.uk
(UK, ``/data.akn``), LegalDocML.de from NeuRIS (DE), the EU's Formex successors.
Each provision already carries an ``eId``, the anchor a citation keeps. What a
publisher decides differently is configuration: which element is the unit of a
passage (``article`` for Fedlex, ``section`` for the UK), which inline elements
are notes rather than law (Fedlex's ``authorialNote`` footnotes cite the
amending act, and read inline they split a sentence of the provision in two).

Parsing is lxml's, with entity resolution and network access off: the bytes
come from the outside and are treated as such.
"""

from __future__ import annotations

import copy

from lxml import etree
from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.engines.base import collapse
from pydantic import Field

AKN_NAMESPACE = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0"
_NS = {"akn": AKN_NAMESPACE}


class AknConfig(EngineConfig):
    #: The element that becomes one passage.
    unit: str = "article"
    #: Inline elements left out of the text: footnotes, editorial remarks.
    drop: tuple[str, ...] = ("authorialNote",)
    #: Title language: the FRBRname with this ``xml:lang`` wins over ``docTitle``.
    language: str = ""
    #: ``FRBRdate/@name`` of the expression's point in time. Empty: the expression's first FRBRdate.
    version_date_name: str = ""
    max_passages: int = Field(default=2000, ge=1)


def _parser() -> etree.XMLParser:
    return etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_comments=True)


class Akn(Engine):
    name = "akn"
    config_model = AknConfig

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        try:
            root = etree.fromstring(body, parser=_parser())
        except etree.XMLSyntaxError as exc:
            raise EngineError(f"not Akoma Ntoso XML: {exc}") from exc
        if etree.QName(root).namespace != AKN_NAMESPACE:
            raise EngineError(f"root element is not in the Akoma Ntoso namespace: {root.tag}")
        units = root.iterfind(f".//akn:{self.config.unit}", _NS)
        passages = tuple(self._passage(unit) for _, unit in zip(range(self.config.max_passages), units, strict=False))
        return ParsedDocument(
            title=self._title(root),
            uri=_first(root, ".//akn:FRBRExpression/akn:FRBRuri/@value")
            or _first(root, ".//akn:FRBRWork/akn:FRBRuri/@value")
            or url,
            version=self._version(root),
            passages=passages,
        )

    def _text(self, element) -> str:
        if element is None:
            return ""
        clone = copy.deepcopy(element)
        for name in self.config.drop:
            for note in clone.findall(f".//akn:{name}", _NS):
                _remove_keeping_tail(note)
        return collapse(_block_text(clone))

    def _passage(self, unit) -> Passage:
        number = self._text(unit.find("akn:num", _NS))
        heading = self._text(unit.find("akn:heading", _NS))
        body = copy.deepcopy(unit)
        for name in ("num", "heading"):
            child = body.find(f"akn:{name}", _NS)
            if child is not None:
                body.remove(child)
        return Passage(anchor=unit.get("eId", ""), number=number, heading=heading, text=self._text(body))

    def _title(self, root) -> str:
        if self.config.language:
            names = root.xpath(
                ".//akn:FRBRWork/akn:FRBRname[@xml:lang=$lang]/@value", namespaces=_NS, lang=self.config.language
            )
            if names:
                return str(names[0])
        title = root.find(".//akn:docTitle", _NS)
        return collapse(" ".join(title.itertext())) if title is not None else ""

    def _version(self, root) -> str:
        if self.config.version_date_name:
            dates = root.xpath(".//akn:FRBRdate[@name=$name]/@date", namespaces=_NS, name=self.config.version_date_name)
            return str(dates[0]) if dates else ""
        return _first(root, ".//akn:FRBRExpression/akn:FRBRdate/@date")


def _first(root, path: str) -> str:
    found = root.xpath(path, namespaces=_NS)
    return str(found[0]) if found else ""


def _remove_keeping_tail(element) -> None:
    parent = element.getparent()
    tail = element.tail or ""
    previous = element.getprevious()
    if previous is not None:
        previous.tail = (previous.tail or "") + tail
    else:
        parent.text = (parent.text or "") + tail
    parent.remove(element)


#: Elements that start a new line in the text: the structure a reader sees.
_BLOCKS = {"paragraph", "subparagraph", "item", "point", "listIntroduction", "listWrapUp", "p", "intro", "wrapUp"}


def _block_text(element) -> str:
    """The element's text with a line per block, a block's ``num`` on the line it numbers ("2 Sie …")."""
    parts: list[str] = []
    after_num = False

    def emit(text: str | None) -> None:
        nonlocal after_num
        if text:
            parts.append(text)
            after_num = after_num and not text.strip()

    def walk(node) -> None:
        nonlocal after_num
        name = etree.QName(node).localname if isinstance(node.tag, str) else ""
        if name in _BLOCKS and not after_num:
            parts.append("\n")
        if name == "num":
            parts.append("\n" + collapse("".join(node.itertext())).replace("\n", " ") + " ")
            after_num = True
            return
        emit(node.text)
        for child in node:
            walk(child)
            emit(child.tail)

    walk(element)
    return "".join(parts)
