"""[1] The address the caller's words already carry. Deterministic, no LLM.

A legal question usually states where its answer sits: a provision, a named
law, a territory. Reading that out is text matching, not reasoning, and doing
it here is what lets the rest of the pipeline skip both LLM calls (the search
planner AND the provision picker) whenever the caller already named one.

Every word read here is the source's (its ``lookup.locus`` and its territory
choices, compiled in ``locus.py``). Pure: every function takes strings and the
source and returns values. The one exception is the turn's site, a request fact
read from the knowledge context; it is isolated in its own function so the rest
stays testable without a request context.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from agent.knowledge.law_lookup.locus import Grammar
from agent.knowledge.law_lookup.source import LawSource

logger = logging.getLogger(__name__)

_BARE = re.compile(r"\s*(\d{1,3})([a-z]?)\b", re.IGNORECASE)
_ORDINAL_AHEAD = re.compile(r"\.\s*\w")

MAX_ADDRESSED_SECTIONS = 6

_DOCUMENT_NUMBER_RE = re.compile(r"^(?=[A-Za-z0-9_.\-]*\d{4})[A-Za-z]{2,4}[A-Za-z0-9_.\-]{4,}$")

TERRITORY_FROM_ARGUMENT = "jurisdiction argument"
TERRITORY_FROM_INSTRUMENT = "instrument argument"
TERRITORY_FROM_QUESTION = "the question"
TERRITORY_FROM_BRIEF = "the project brief"

_MAX_RANGE_SPAN = 1000


@dataclass(frozen=True)
class Address:
    """What the caller's words already say about WHERE the answer sits."""

    kind: str = ""  # a unit's sign ("§", "Art") or ""
    number: str = ""
    numbers: tuple[str, ...] = ()
    unread: tuple[str, ...] = ()
    subsection: str = ""
    law: str = ""
    url: str = ""
    document_number: str = ""
    territory: str = ""
    territory_source: str = ""

    @property
    def has_section(self) -> bool:
        """Whether a provision was named: the deterministic path's trigger."""
        return bool(self.kind and self.number)

    @property
    def sections(self) -> tuple[str, ...]:
        """Every addressed number: the list when one was named, else the one."""
        return self.numbers or ((self.number,) if self.number else ())


def _first_section(text: str, grammar: Grammar) -> tuple[str, str, int]:
    """``(kind, number, where)`` of the first provision of the preferred unit, else the next; ``("", "", -1)``."""
    for unit in grammar.units:
        match = grammar.first[unit.sign].search(text)
        if match:
            return unit.sign, match.group(1), match.start()
    return "", "", -1


def _list_from(text: str, kind: str, start: int, grammar: Grammar) -> tuple[tuple[str, ...], int]:
    """Every provision a list starting at ``start`` names, and where the list ends.

    Ranges expanded (:func:`_extend`); a part, item or letter after an item is
    part of it; after one, only a SIGNED item continues the list. Not capped:
    :func:`parse_address` addresses the first :data:`MAX_ADDRESSED_SECTIONS`
    and reports the rest as unread.
    """
    first = grammar.signed[kind].match(text, start)
    if first is None:
        return (), start
    items, end = [first.group(1) + first.group(2).lower()], first.end()
    while True:
        qualified = False
        while qualifier := grammar.qualifier.match(text, end):
            qualified, end = True, qualifier.end()
        join = grammar.join.match(text, end)
        item = join and _next_item(text, kind, join, grammar, qualified=qualified)
        if not item:
            return tuple(dict.fromkeys(items)), end
        ranged = join.group(1).lower() in grammar.range_joins
        _extend(items, item.group(1), item.group(2).lower(), ranged=ranged)
        end = item.end()


def _next_item(text: str, kind: str, join: re.Match[str], grammar: Grammar, *, qualified: bool):
    """The item after ``join``: signed always; bare only after an unqualified item, and not an ordinal."""
    signed = grammar.signed[kind].match(text, join.end())
    if signed or qualified:
        return signed
    bare = _BARE.match(text, join.end())
    if bare and join.group(1) == "," and _ORDINAL_AHEAD.match(text, bare.end()):
        return None
    return bare


def _extend(items: list[str], digits: str, letter: str, *, ranged: bool) -> None:
    """Add one item, or the range from the last one to it ("7a to 9" → 8, 9; "5a-5c" → 5b, 5c).

    A range that does not ascend names nothing anyone meant, and adds nothing.
    """
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


def section_in(text: str, grammar: Grammar) -> tuple[str, str]:
    """The first ``(kind, number)`` a text names, or ``("", "")``."""
    kind, number, _where = _first_section(text, grammar)
    return kind, number


def parse_address(question: str, instrument: str, jurisdiction: str, law: LawSource) -> Address:
    """Read the address out of the caller's arguments.

    The ``instrument`` argument outranks the question for the provision and the
    law: it is what the caller chose to state as an address, while the question
    is prose that may mention a provision in passing.
    """
    grammar = law.grammar
    instrument = law.public_host((instrument or "").strip())
    url = instrument if law.addressable(instrument) else ""
    number = instrument if not url and _DOCUMENT_NUMBER_RE.match(instrument) else ""
    source = instrument if instrument and not url and not number else ""
    kind, section, where = _first_section(source, grammar)
    if not section:
        source = question or ""
        kind, section, where = _first_section(source, grammar)
    items = _list_from(source, kind, where, grammar)[0] if kind else ()
    listed = items if len(items) > 1 else ()
    subsection = (
        None if listed else (grammar.subsection.search(instrument) or grammar.subsection.search(question or ""))
    )
    territory, territory_source = assumed_territory(jurisdiction, instrument, question or "", law)
    return Address(
        kind=kind,
        number=section,
        numbers=listed[:MAX_ADDRESSED_SECTIONS],
        unread=listed[MAX_ADDRESSED_SECTIONS:],
        subsection=subsection.group(1) if subsection else "",
        law=_law_name(instrument, url, number, grammar),
        url=url,
        document_number=number,
        territory=territory,
        territory_source=territory_source,
    )


def _law_name(instrument: str, url: str, number: str, grammar: Grammar) -> str:
    """The named law inside ``instrument``, with the provisions and parts taken out."""
    if url or number:
        return ""
    rest = instrument
    for _ in range(8):
        kind, _number, where = _first_section(rest, grammar)
        if not kind:
            break
        _items, end = _list_from(rest, kind, where, grammar)
        rest = f"{rest[:where]} {rest[max(end, where + 1) :]}"
    rest = grammar.subsection_list.sub("", rest)
    rest = grammar.trailing_reference.sub("", re.sub(r"\s{2,}", " ", rest).strip(" ,;-–"))
    return rest.strip(" ,.;-–")


def _normalize(text: str) -> str:
    """Lowercase and expand umlauts, as the norm catalog matches (``norm_registry._normalize``)."""
    return text.strip().lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


def territory_in(text: str, law: LawSource) -> str:
    """The first of the source's territories a text names, in the record's probe order; ``""`` for none."""
    territory = law.lookup.territory
    if not text or territory is None:
        return ""
    normalized = _normalize(text)
    fact = _territory_fact(normalized, territory)
    if fact is not None:
        return fact
    return next((choice for choice in territory.choices if _normalize(choice) in normalized), "")


def _territory_fact(normalized: str, territory) -> str | None:
    """The territory a structured fact line names (``federal_state=<token>``); None when the text has none."""
    if not territory.fact_keys:
        return None
    keys = "|".join(re.escape(_normalize(key)) for key in territory.fact_keys)
    found = re.search(rf"\b(?:{keys})=([a-z_]+)", normalized)
    if found is None:
        return None
    from agent.profile_names import normalize_profile_token

    return territory.fact_values.get(normalize_profile_token(territory.fact_keys[0], found.group(1)), "")


def assumed_territory(jurisdiction: str, instrument: str, question: str, law: LawSource) -> tuple[str, str]:
    """The territory to work in, and WHERE it came from.

    Precedence is the caller's explicit word, then the instrument they named,
    then the question, then the turn's site. Both halves travel: a miss states
    the assumption AND its source, because "because you said so" and "because
    the project is there" call for different corrections.
    """
    for value, origin in (
        (jurisdiction, TERRITORY_FROM_ARGUMENT),
        (instrument, TERRITORY_FROM_INSTRUMENT),
        (question, TERRITORY_FROM_QUESTION),
    ):
        territory = territory_in(value, law)
        if territory:
            return territory, origin
    return _territory_of_site(law)


def territory_sentence(address: Address, law: LawSource) -> str:
    """The assumed jurisdiction and where it came from, as one sentence.

    Rendered on a HIT as well as on a miss: ``focus_entries`` silently drops
    every other territory's law, so the assumption that did the dropping has to
    be visible in the result it produced.
    """
    word = law.wording.subdivision
    if not address.territory:
        return (
            f"No {word} was resolved (not in the arguments, the question or the project brief), "
            f"so state law was not narrowed to one {law.subdivision_short}."
        )
    return f"Assumed {word}: {address.territory} (from {address.territory_source})."


def _territory_of_site(law: LawSource) -> tuple[str, str]:
    """The territory of the turn's site, or ``("", "")``.

    The first node on the site's chain (from its knowledge context, ADR-0175)
    that the source names; no text is read. No placed site, one outside the
    source's territories, or no turn at all (tests) is none, which is not an error.
    """
    names = law.lookup.territory.names if law.lookup.territory else {}
    try:
        from agent.common.knowledge_context import turn_knowledge_context

        chain = next(iter(turn_knowledge_context().chains.values()), ())
    except Exception:  # noqa: BLE001 — no request context is the normal case off-request
        logger.debug("law_lookup: no site territory available", exc_info=True)
        return "", ""
    territory = next((names[node] for node in chain if node in names), "")
    return (territory, TERRITORY_FROM_BRIEF) if territory else ("", "")
