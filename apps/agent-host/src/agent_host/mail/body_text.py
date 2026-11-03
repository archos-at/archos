"""A mail body as plain text, whichever of its three forms the message kept.

Shared by the two places mail arrives: an inbound message to a project's
address (:mod:`agent_host.mail.read`) and a message in an Outlook archive
(:mod:`agent_host.mail_archive.reader`). A message stores its body as plain text,
HTML, RTF, or several of them. The Outlook.com fixture keeps RTF only for most
of its 183 items, and the Enron fixture plain text only, so every form has to
read. Plain text wins when it is there, because it is what the sender's client
wrote; HTML is next; RTF (libpff hands it over decompressed) is last.

HTML reads as a browser shows it: the markup's own line breaks and
indentation are one space (outside ``<pre>``), and a block element ends a
line. A table keeps its cells apart: each cell but a row's last ends in
`` | ``, so "Stellplätze | 12" does not read "Stellplätze12" (RT-X3).

What a reader cannot see is not text (ADR-0137, amendment of 2026-11-03): a
mail is indexed as the project's data, and a ``display:none`` paragraph that
tells a model what to do is the oldest trick for putting words into an index
that no person ever read. Dropped from HTML before it is read: ``script``,
``style``, ``head``, ``title`` and ``template``; an element hidden by its inline
style (``display:none``, ``visibility:hidden``, ``mso-hide:all``, a zero
``font-size`` or ``opacity``, a zero ``height`` or ``max-height`` with
``overflow:hidden``; ``font-size`` and ``visibility`` are inherited, so a child
that sets them back is read); the ``hidden`` attribute and ``aria-hidden="true"``; and a
tracking pixel (an image 0 or 1 pixel wide or high). An image's ``alt`` is never
read in any case. From every form, plain and RTF too: zero-width characters,
the soft hyphen and the bidi controls, which split a word so a search misses it
or turn a name around on screen. A colour equal to the background is not
detected: the background can come from any ancestor or a stylesheet.

Encapsulated HTML (an RTF body with ``\\fromhtml1``) needs no separate path:
its markup lives in ``{\\*\\htmltag ...}`` destinations, which an RTF reader
skips, so what is left is the text a reader saw.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from lxml import html as lxml_html
from lxml.etree import ParserError
from striprtf.striprtf import rtf_to_text

#: The longest body kept, in characters. A body past it is cut and says so.
MAX_BODY_CHARS = 1_000_000

#: Elements whose end is a line break in what a reader sees.
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

#: Elements that are one cell of a table row.
_CELL_TAGS = frozenset({"td", "th"})

#: What stands between two cells of a row.
CELL_SEPARATOR = " | "

_SKIPPED_TAGS = ("script", "style", "head", "title", "template")
#: Characters a reader never sees that split or turn the text around them: zero-width
#: space, non-joiner and joiner, word joiner, the byte-order mark, the soft hyphen,
#: the directional marks, and the bidi embeddings, overrides and isolates.
_INVISIBLE = re.compile("[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]")
#: A CSS length or number that is zero (``0``, ``0px``, ``0.0em``, ``0%``).
_ZERO = re.compile(r"(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?")
#: An image this wide or high, or less, is a tracking pixel.
_PIXEL = 1
#: Whitespace in markup, which a browser shows as one space (outside ``<pre>``).
_MARKUP_SPACE = re.compile(r"\s+")
_LINE_START_SPACE = re.compile(r"\n ")
#: Characters XML 1.0 does not allow. libxml2 reads past some of them, and lxml
#: then refuses to write a text node that holds one (``ValueError``).
_NOT_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")
_BLANK_RUN = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)+")
_TRAILING_SPACE = re.compile(r"[ \t]+\n")


@dataclass(frozen=True)
class BodyText:
    text: str
    #: Which of the stored forms the text came from: plain, html, rtf, or none.
    source: str
    truncated: bool


def decode(raw: bytes | str | None) -> str:
    """Bytes from libpff as text: UTF-8 for a Unicode archive, the ANSI code page for an old one."""
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def html_to_text(markup: str) -> str:
    """What a mail client shows of ``markup``, line breaks and table cells kept apart."""
    markup = _NOT_XML.sub("", markup)
    if not markup.strip():
        return ""
    try:
        root = lxml_html.document_fromstring(markup)
    except ValueError:
        # A str that declares its own encoding (``<?xml ... encoding=...?>``,
        # which Outlook writes) is refused as a str; as bytes it parses.
        root = _parse_bytes(markup)
    except ParserError:
        # Nothing to parse (markup that is only a comment or a doctype).
        return ""
    if root is None:
        return ""
    # Listed first: dropping an element while iterating skips its next sibling.
    # ``drop_tree`` keeps the element's tail, the visible text after it.
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
    """Every element nothing inside of can be seen, by its attributes, outermost and inner alike."""
    return [
        element for element in root.iter() if isinstance(element.tag, str) and element is not root and _hidden(element)
    ]


def _hidden(element: lxml_html.HtmlElement) -> bool:
    """Hidden with everything inside it: no descendant can take it back."""
    if element.get("hidden") is not None or (element.get("aria-hidden") or "").strip().lower() == "true":
        return True
    style = _declarations(element.get("style") or "")
    if element.tag == "img" and _tracking_pixel(element, style):
        return True
    clipped = style.get("overflow") == "hidden" and (_is_zero(style.get("height")) or _is_zero(style.get("max-height")))
    return clipped or style.get("display") == "none" or style.get("mso-hide") == "all" or _is_zero(style.get("opacity"))


def _blank_unseen_text(root: lxml_html.HtmlElement) -> None:
    """Blank the text an inherited ``font-size:0`` or ``visibility:hidden`` hides.

    Both are inherited, and a child may set them back: a responsive mail puts
    ``font-size:0`` on the cell that holds its columns, to swallow the spaces
    between them, and gives each column its own size. So only the text whose
    nearest declaration hides it goes, and the elements stay.
    """
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
    """Drop the text an element holds itself: its own text and its children's tails, never the children."""
    element.text = None
    for child in element:
        child.tail = None


def _declarations(style: str) -> dict[str, str]:
    """An inline ``style`` as lowercase property → value, ``!important`` and spaces dropped; the last one wins."""
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
    """Fold the markup's own line breaks and indentation to one space, as a browser does."""
    for element in root.iter():
        if element.text and isinstance(element.tag, str) and not _preformatted(element):
            element.text = _MARKUP_SPACE.sub(" ", element.text)
        parent = element.getparent()
        if element.tail and (parent is None or not _preformatted(parent)):
            element.tail = _MARKUP_SPACE.sub(" ", element.tail)


def _preformatted(element: lxml_html.HtmlElement) -> bool:
    return element.tag == "pre" or any(True for _ in element.iterancestors("pre"))


def body_text(plain: bytes | str | None, markup: bytes | str | None, rtf: bytes | str | None) -> BodyText:
    """The body as text, from the best form stored, bounded."""
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
