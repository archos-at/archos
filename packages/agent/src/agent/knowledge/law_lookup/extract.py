"""[4] Which provisions answer the question. CAP: six, across two documents.

Two paths, and the first one is free:

* **Deterministic**: the caller named a provision, or a list of them, so
  ``sections`` finds each by number and returns it with its parts, all from
  the one document already fetched. No LLM call at all, which is the whole
  reason ``address.py`` runs first.
* **Ranked**: nobody named one, so ONE call to the picker model reads the
  law's HEADINGS (never a body: that keeps this call's input bounded by the
  table of contents rather than by the length of the law) and returns up to
  six ids. The grammar then cuts those provisions out, so what reaches the
  answering model is the law's own text, not the picker's summary of it.

A document the grammar finds no provisions in (a court decision) is one
passage. A document whose provisions answer nothing puts its headings on the
trace, as an INDEX: see ``miss.miss_message``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.address import section_in
from agent.knowledge.law_lookup.fetch import FetchedDocument
from agent.knowledge.law_lookup.sections import SECTION_MAX_CHARS
from agent.knowledge.law_lookup.sections import Section
from agent.knowledge.law_lookup.sections import headings_index
from agent.knowledge.law_lookup.sections import split_sections
from agent.knowledge.law_lookup.sections import subsection_body
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.trace import LookupTrace

logger = logging.getLogger(__name__)

#: Passages returned per call, across at most :data:`MAX_DOCUMENTS` documents.
MAX_PASSAGES = 6
MAX_DOCUMENTS = 2


@dataclass(frozen=True)
class Selection:
    """The sections picked out of ONE document, each with its part (or none)."""

    fetched: FetchedDocument
    picks: tuple[tuple[Section, str], ...]


async def select_passages(picker, question: str, address: Address, documents, trace: LookupTrace, law: LawSource):
    """At most six passages across at most two documents, as ``Selection``s."""
    selections: list[Selection] = []
    budget = MAX_PASSAGES
    for fetched in documents[:MAX_DOCUMENTS]:
        sections = split_sections(fetched.document.text, law.grammar)
        picks = await _pick(picker, question, address, sections, fetched, law)
        if not picks and sections:
            trace.headings.append(_index_for(fetched, sections, law))
        selections.append(Selection(fetched=fetched, picks=tuple(picks[:budget])))
        budget -= len(picks[:budget])
        if budget <= 0:
            break
    return [selection for selection in selections if selection.picks]


def _index_for(fetched: FetchedDocument, sections: list[Section], law: LawSource) -> str:
    """One read-but-unanswering document's heading index, titled."""
    title = fetched.document.title or fetched.candidate.title
    return f"{title}:\n{headings_index(sections, law.section_plural)}"


async def _pick(picker, question, address: Address, sections, fetched, law: LawSource) -> list[tuple[Section, str]]:
    """``(section, subsection)`` pairs to return: deterministic first, LLM second."""
    if not sections:
        return _whole_document(fetched)
    if address.has_section:
        return [
            pick
            for section in sections
            if _is_addressed(section, address)
            for pick in _addressed(section, address, law)
        ]
    if picker is None:
        return []
    return await _picker_picks(picker, question, sections, law)


def _addressed(section: Section, address: Address, law: LawSource) -> list[tuple[Section, str]]:
    """The named part first, and the whole provision beside it when the provision fits.

    "Part 2 means part 2" keeps the citation precise, but read alone it was a
    keyhole: asked for one part, the agent came back for the others one lookup
    at a time (answer suite, 92 s). The provision under its own key costs one
    passage and ends that.
    """
    if not address.subsection or len(section.body) > SECTION_MAX_CHARS:
        return [(section, address.subsection)]
    # A part the provision does not carry resolves to the whole provision already:
    # a second pick would be the same passage under the same citation key.
    if not subsection_body(section, address.subsection, law.grammar)[1]:
        return [(section, address.subsection)]
    return [(section, address.subsection), (section, "")]


def _is_addressed(section: Section, address: Address) -> bool:
    return section.kind == address.kind and section.number.lower() in {n.lower() for n in address.sections}


def _whole_document(fetched: FetchedDocument) -> list[tuple[Section, str]]:
    """A document with no provision grammar (a court decision) is one passage, unnumbered."""
    document = fetched.document
    return [(Section(kind="", number="", heading=document.title, body=document.text), "")]


async def _picker_picks(picker, question: str, sections: list[Section], law: LawSource) -> list[tuple[Section, str]]:
    """One picker call over the HEADINGS; unknown ids are dropped, not guessed."""
    try:
        plan = await picker(question, headings_index(sections, law.section_plural))
    except Exception:  # noqa: BLE001 — a failed pick returns the index, never a guess
        logger.warning("law_lookup: provision picker failed, returning the document index instead", exc_info=True)
        return []
    by_label = {_normalize_label(section.label, law): section for section in sections}
    picked = [by_label.get(_normalize_label(pick.section, law)) for pick in plan.picks[:MAX_PASSAGES]]
    return [(section, "") for section in picked if section is not None]


def _normalize_label(label: str, law: LawSource) -> str:
    """``"§ 63."`` / ``"Artikel 5"`` → ``"§63"`` / ``"art5"`` for lookup."""
    kind, number = section_in(label, law.grammar)
    return f"{kind.lower()}{number.lower()}" if number else label.strip().casefold()
