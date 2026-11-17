from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from ris_adapter.client import ALLOWED_DOCUMENT_HOSTS
from ris_adapter.client import public_host
from ris_adapter.register import _CATALOG_AVAILABLE
from ris_adapter.register import extract_federal_state

logger = logging.getLogger(__name__)

PARAGRAPH_RE = re.compile(r"§+\s*(\d+[a-z]?)")
ARTICLE_RE = re.compile(r"\bArt(?:ikel)?\.?\s*(\d+[a-z]?)\b", re.IGNORECASE)
SUBSECTION_RE = re.compile(r"\bAbs(?:atz|\.)?\s*(\d+[a-z]?)\b", re.IGNORECASE)

_SIGNED = {
    "§": re.compile(r"\s*§+\s*(\d+)([a-z]?)\b", re.IGNORECASE),
    "Art": re.compile(r"\s*\bArt(?:ikel)?\.?\s*(\d+)([a-z]?)\b", re.IGNORECASE),
}
_BARE = re.compile(r"\s*(\d{1,3})([a-z]?)\b", re.IGNORECASE)
_ORDINAL_AHEAD = re.compile(r"\.\s*\w")
_JOIN_RE = re.compile(r"\s*(,|\bund\b|\bsowie\b|\bu\.|\bbis\b|–|-)", re.IGNORECASE)
_RANGE_JOINS = frozenset({"bis", "–", "-"})
_QUALIFIER_JOIN = r"\s*(?:,|\bund\b|\bbis\b|–|-)\s*"
_QUALIFIER_RE = re.compile(
    r"\s*(?:"
    r"(?:Abs(?:atz|\.)?|Z(?:iffer|\.)?)\s*\d+[a-z]?\b"
    rf"(?:{_QUALIFIER_JOIN}(?:(?:Abs(?:atz|\.)?|Z(?:iffer|\.)?)\s*)?\d+[a-z]?\b(?!\.\s*\w))*"
    r"|lit\.?\s*(?-i:[a-z])\b"
    rf"(?:{_QUALIFIER_JOIN}(?:lit\.?\s*)?(?-i:[a-z])\b(?!\.\s*\w))*"
    r"|,?\s*\d+\.\s*Satz\b)",
    re.IGNORECASE,
)
_SUBSECTION_LIST_RE = re.compile(r"\bAbs(?:atz|\.)?\s*\d+[a-z]?(?:\s*(?:,|und|bis|–|-)\s*\d+[a-z]?)*", re.IGNORECASE)

_TRAILING_REFERENCE_RE = re.compile(
    r"(?:[\s,;]+(?:siehe|vgl\.?|s\.)|\s*\(\s*(?:siehe|vgl\.?|s\.)(?:\s*\))?)+$", re.IGNORECASE
)

MAX_ADDRESSED_SECTIONS = 6

_DOCUMENT_NUMBER_RE = re.compile(r"^(?=[A-Za-z0-9_.\-]*\d{4})[A-Za-z]{2,4}[A-Za-z0-9_.\-]{4,}$")

FEDERAL_STATE_FROM_ARGUMENT = "jurisdiction argument"
FEDERAL_STATE_FROM_INSTRUMENT = "instrument argument"
FEDERAL_STATE_FROM_QUESTION = "the question"
FEDERAL_STATE_FROM_BRIEF = "the project brief"


@dataclass(frozen=True)
class Address:

    kind: str = ""  # "§" | "Art" | ""
    number: str = ""
    numbers: tuple[str, ...] = ()
    unread: tuple[str, ...] = ()
    subsection: str = ""
    law: str = ""
    url: str = ""
    document_number: str = ""
    federal_state: str = ""
    federal_state_source: str = ""

    @property
    def has_section(self) -> bool:
        return bool(self.kind and self.number)

    @property
    def sections(self) -> tuple[str, ...]:
        return self.numbers or ((self.number,) if self.number else ())


_MAX_RANGE_SPAN = 1000


def _first_section(text: str) -> tuple[str, str, int]:
    paragraph = PARAGRAPH_RE.search(text)
    if paragraph:
        return "§", paragraph.group(1), paragraph.start()
    artikel = ARTICLE_RE.search(text)
    return ("Art", artikel.group(1), artikel.start()) if artikel else ("", "", -1)


def _list_from(text: str, kind: str, start: int) -> tuple[tuple[str, ...], int]:
    first = _SIGNED[kind].match(text, start)
    if first is None:
        return (), start
    items, end = [first.group(1) + first.group(2).lower()], first.end()
    while True:
        qualified = False
        while qualifier := _QUALIFIER_RE.match(text, end):
            qualified, end = True, qualifier.end()
        join = _JOIN_RE.match(text, end)
        item = join and _next_item(text, kind, join, qualified=qualified)
        if not item:
            return tuple(dict.fromkeys(items)), end
        _extend(items, item.group(1), item.group(2).lower(), ranged=join.group(1).lower() in _RANGE_JOINS)
        end = item.end()


def _next_item(text: str, kind: str, join: re.Match[str], *, qualified: bool) -> re.Match[str] | None:
    signed = _SIGNED[kind].match(text, join.end())
    if signed or qualified:
        return signed
    bare = _BARE.match(text, join.end())
    if bare and join.group(1) == "," and _ORDINAL_AHEAD.match(text, bare.end()):
        return None
    return bare


def _extend(items: list[str], digits: str, letter: str, *, ranged: bool) -> None:
    if not ranged:
        items.append(digits + letter)
        return
    previous = re.match(r"(\d+)([a-z]?)", items[-1])
    start, start_letter, end = int(previous.group(1)), previous.group(2), int(digits)
    if end == start and letter and letter > start_letter:
        first = chr(ord(start_letter) + 1) if start_letter else "a"
        items.extend(f"{end}{chr(code)}" for code in range(ord(first), ord(letter) + 1))
        return
    if end <= start:
        return
    last = min(end, start + _MAX_RANGE_SPAN)
    items.extend(str(value) for value in range(start + 1, last + 1))
    if letter and last == end:
        items.append(f"{end}{letter}")


def section_in(text: str) -> tuple[str, str]:
    kind, number, _where = _first_section(text)
    return kind, number


def is_ris_url(value: str) -> bool:
    if not value.lower().startswith(("http://", "https://")):
        return False
    try:
        return urlparse(value).hostname in ALLOWED_DOCUMENT_HOSTS
    except ValueError:
        return False


def parse_address(question: str, instrument: str, jurisdiction: str) -> Address:
    instrument = public_host((instrument or "").strip())
    url = instrument if is_ris_url(instrument) else ""
    number = instrument if not url and _DOCUMENT_NUMBER_RE.match(instrument) else ""
    source = instrument if instrument and not url and not number else ""
    kind, section, where = _first_section(source)
    if not section:
        source = question or ""
        kind, section, where = _first_section(source)
    items = _list_from(source, kind, where)[0] if kind else ()
    listed = items if len(items) > 1 else ()
    subsection = None if listed else (SUBSECTION_RE.search(instrument) or SUBSECTION_RE.search(question or ""))
    federal_state, federal_state_source = assumed_federal_state(jurisdiction, instrument, question or "")
    return Address(
        kind=kind,
        number=section,
        numbers=listed[:MAX_ADDRESSED_SECTIONS],
        unread=listed[MAX_ADDRESSED_SECTIONS:],
        subsection=subsection.group(1) if subsection else "",
        law=_law_name(instrument, url, number),
        url=url,
        document_number=number,
        federal_state=federal_state,
        federal_state_source=federal_state_source,
    )


def _law_name(instrument: str, url: str, number: str) -> str:
    if url or number:
        return ""
    rest = instrument
    for _ in range(8):
        kind, _number, where = _first_section(rest)
        if not kind:
            break
        _items, end = _list_from(rest, kind, where)
        rest = f"{rest[:where]} {rest[max(end, where + 1) :]}"
    rest = _SUBSECTION_LIST_RE.sub("", rest)
    rest = _TRAILING_REFERENCE_RE.sub("", re.sub(r"\s{2,}", " ", rest).strip(" ,;-–"))
    return rest.strip(" ,.;-–")


def assumed_federal_state(jurisdiction: str, instrument: str, question: str) -> tuple[str, str]:
    if not _CATALOG_AVAILABLE:
        return "", ""
    for value, origin in (
        (jurisdiction, FEDERAL_STATE_FROM_ARGUMENT),
        (instrument, FEDERAL_STATE_FROM_INSTRUMENT),
        (question, FEDERAL_STATE_FROM_QUESTION),
    ):
        federal_state = extract_federal_state(value) if value else None
        if federal_state:
            return federal_state, origin
    return _federal_state_from_brief()


def federal_state_sentence(address: Address) -> str:
    if not address.federal_state:
        return (
            "No Bundesland was resolved (not in the arguments, the question or the project brief), "
            "so state law was not narrowed to one Land."
        )
    return f"Assumed Bundesland: {address.federal_state} (from {address.federal_state_source})."


def _federal_state_from_brief() -> tuple[str, str]:
    try:
        from agent.common.norm_registry import resolve_federal_state

        federal_state = resolve_federal_state()
    except Exception:  # noqa: BLE001 — no request context is the normal case off-request
        logger.debug("ris_lookup: no project-brief jurisdiction available", exc_info=True)
        return "", ""
    return (federal_state, FEDERAL_STATE_FROM_BRIEF) if federal_state else ("", "")
