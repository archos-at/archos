from __future__ import annotations

import logging
from dataclasses import dataclass

from ris_adapter.lookup.address import Address
from ris_adapter.lookup.address import section_in
from ris_adapter.lookup.fetch import FetchedDocument
from ris_adapter.lookup.grammar import SECTION_MAX_CHARS
from ris_adapter.lookup.grammar import Section
from ris_adapter.lookup.grammar import headings_index
from ris_adapter.lookup.grammar import split_sections
from ris_adapter.lookup.grammar import subsection_body
from ris_adapter.lookup.trace import LookupTrace

logger = logging.getLogger(__name__)

MAX_PASSAGES = 6
MAX_DOCUMENTS = 2


@dataclass(frozen=True)
class Selection:

    fetched: FetchedDocument
    picks: tuple[tuple[Section, str], ...]


async def select_passages(picker, question: str, address: Address, documents, trace: LookupTrace):
    selections: list[Selection] = []
    budget = MAX_PASSAGES
    for fetched in documents[:MAX_DOCUMENTS]:
        sections = split_sections(fetched.document.text)
        picks = await _pick(picker, question, address, sections, fetched)
        if not picks and sections:
            trace.headings.append(_index_for(fetched, sections))
        selections.append(Selection(fetched=fetched, picks=tuple(picks[:budget])))
        budget -= len(picks[:budget])
        if budget <= 0:
            break
    return [selection for selection in selections if selection.picks]


def _index_for(fetched: FetchedDocument, sections: list[Section]) -> str:
    title = fetched.document.title or fetched.candidate.title
    return f"{title}:\n{headings_index(sections)}"


async def _pick(picker, question, address: Address, sections, fetched) -> list[tuple[Section, str]]:
    if not sections:
        return _whole_document(fetched)
    if address.has_section:
        return [
            pick for section in sections if _is_addressed(section, address) for pick in _addressed(section, address)
        ]
    if picker is None:
        return []
    return await _picker_picks(picker, question, sections)


def _addressed(section: Section, address: Address) -> list[tuple[Section, str]]:
    if not address.subsection or len(section.body) > SECTION_MAX_CHARS:
        return [(section, address.subsection)]
    if not subsection_body(section, address.subsection)[1]:
        return [(section, address.subsection)]
    return [(section, address.subsection), (section, "")]


def _is_addressed(section: Section, address: Address) -> bool:
    return section.kind == address.kind and section.number.lower() in {n.lower() for n in address.sections}


def _whole_document(fetched: FetchedDocument) -> list[tuple[Section, str]]:
    document = fetched.document
    return [(Section(kind="", number="", heading=document.title, body=document.text), "")]


async def _picker_picks(picker, question: str, sections: list[Section]) -> list[tuple[Section, str]]:
    try:
        plan = await picker(question, headings_index(sections))
    except Exception:  # noqa: BLE001 — a failed pick returns the index, never a guess
        logger.warning("ris_lookup: § picker failed, returning the document index instead", exc_info=True)
        return []
    by_label = {_normalize_label(section.label): section for section in sections}
    picked = [by_label.get(_normalize_label(pick.section)) for pick in plan.picks[:MAX_PASSAGES]]
    return [(section, "") for section in picked if section is not None]


def _normalize_label(label: str) -> str:
    kind, number = section_in(label)
    return f"{kind.lower()}{number.lower()}" if number else label.strip().casefold()
