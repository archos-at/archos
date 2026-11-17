from __future__ import annotations

import re
from dataclasses import dataclass

from lxml import html as lxml_html
from lxml.etree import ParserError
from striprtf.striprtf import rtf_to_text

MAX_BODY_CHARS = 1_000_000

_BLOCK_TAGS = frozenset(
    {
        "address",
        "article",
        "blockquote",
        "br",
        "div",
        "dl",
        "dt",
        "dd",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tr",
        "ul",
    }
)

_CELL_TAGS = frozenset({"td", "th"})

CELL_SEPARATOR = " | "

_SKIPPED_TAGS = ("script", "style", "head", "title", "template")
_INVISIBLE = re.compile("[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]")
_ZERO = re.compile(r"(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?")
_PIXEL = 1
_MARKUP_SPACE = re.compile(r"\s+")
_LINE_START_SPACE = re.compile(r"\n ")
_NOT_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")
_BLANK_RUN = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)+")
_TRAILING_SPACE = re.compile(r"[ \t]+\n")


@dataclass(frozen=True)
class BodyText:
    text: str
    source: str
    truncated: bool


def decode(raw: bytes | str | None) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def html_to_text(markup: str) -> str:
    markup = _NOT_XML.sub("", markup)
    if not markup.strip():
        return ""
    try:
        root = lxml_html.document_fromstring(markup)
    except ValueError:
        root = _parse_bytes(markup)
    except ParserError:
        return ""
    if root is None:
        return ""
    for element in [*root.iter(*_SKIPPED_TAGS), *_unseen(root)]:
        element.drop_tree()
    _blank_unseen_text(root)
    _collapse_whitespace(root)
    for row in root.iter("tr"):
        cells = [child for child in row if child.tag in _CELL_TAGS]
        for cell in cells[:-1]:
            cell.tail = CELL_SEPARATOR + (cell.tail or "")
    for element in root.iter(*_BLOCK_TAGS):
        element.tail = "\n" + (element.tail or "")
    return _LINE_START_SPACE.sub("\n", root.text_content())


def _unseen(root: lxml_html.HtmlElement) -> list[lxml_html.HtmlElement]:
    return [
        element for element in root.iter() if isinstance(element.tag, str) and element is not root and _hidden(element)
    ]


def _hidden(element: lxml_html.HtmlElement) -> bool:
    if element.get("hidden") is not None or (element.get("aria-hidden") or "").strip().lower() == "true":
        return True
    style = _declarations(element.get("style") or "")
    if element.tag == "img" and _tracking_pixel(element, style):
        return True
    clipped = style.get("overflow") == "hidden" and (_is_zero(style.get("height")) or _is_zero(style.get("max-height")))
    return clipped or style.get("display") == "none" or style.get("mso-hide") == "all" or _is_zero(style.get("opacity"))


def _blank_unseen_text(root: lxml_html.HtmlElement) -> None:
    unseen: dict[lxml_html.HtmlElement, bool] = {}
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        parent = element.getparent()
        hidden = unseen.get(parent, False) if parent is not None else False
        style = _declarations(element.get("style") or "")
        if "font-size" in style or "visibility" in style:
            hidden = _is_zero(style.get("font-size")) or style.get("visibility") in ("hidden", "collapse")
        unseen[element] = hidden
        if hidden:
            _blank_text(element)


def _blank_text(element: lxml_html.HtmlElement) -> None:
    element.text = None
    for child in element:
        child.tail = None


def _declarations(style: str) -> dict[str, str]:
    declarations: dict[str, str] = {}
    for declaration in style.lower().split(";"):
        name, colon, value = declaration.partition(":")
        if colon:
            declarations[name.strip()] = re.sub(r"\s+", "", value).removesuffix("!important")
    return declarations


def _is_zero(value: str | None) -> bool:
    return value is not None and _ZERO.fullmatch(value) is not None


def _tracking_pixel(image: lxml_html.HtmlElement, style: dict[str, str]) -> bool:
    sizes = (image.get("width"), image.get("height"), style.get("width"), style.get("height"))
    return any(_at_most_a_pixel(size) for size in sizes)


def _at_most_a_pixel(size: str | None) -> bool:
    match = re.fullmatch(r"\s*(\d+(?:\.\d*)?)\s*(?:px)?\s*", size or "")
    return match is not None and float(match.group(1)) <= _PIXEL


def _parse_bytes(markup: str) -> lxml_html.HtmlElement | None:
    try:
        return lxml_html.document_fromstring(markup.encode("utf-8", errors="replace"))
    except ParserError, ValueError:
        return None


def _collapse_whitespace(root: lxml_html.HtmlElement) -> None:
    for element in root.iter():
        if element.text and isinstance(element.tag, str) and not _preformatted(element):
            element.text = _MARKUP_SPACE.sub(" ", element.text)
        parent = element.getparent()
        if element.tail and (parent is None or not _preformatted(parent)):
            element.tail = _MARKUP_SPACE.sub(" ", element.tail)


def _preformatted(element: lxml_html.HtmlElement) -> bool:
    return element.tag == "pre" or any(True for _ in element.iterancestors("pre"))


def body_text(plain: bytes | str | None, markup: bytes | str | None, rtf: bytes | str | None) -> BodyText:
    for source, convert, raw in (
        ("plain", decode, plain),
        ("html", lambda value: html_to_text(decode(value)), markup),
        ("rtf", lambda value: rtf_to_text(decode(value), errors="ignore"), rtf),
    ):
        if not raw:
            continue
        text = _tidy(convert(raw))
        if text:
            return _bounded(text, source)
    return BodyText(text="", source="none", truncated=False)


def _tidy(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = _INVISIBLE.sub("", text)
    text = _TRAILING_SPACE.sub("\n", text)
    return _BLANK_RUN.sub("\n\n", text).strip()


def _bounded(text: str, source: str) -> BodyText:
    if len(text) <= MAX_BODY_CHARS:
        return BodyText(text=text, source=source, truncated=False)
    return BodyText(text=text[:MAX_BODY_CHARS], source=source, truncated=True)
