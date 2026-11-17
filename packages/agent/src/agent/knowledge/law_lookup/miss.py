"""What a lookup says when it found nothing.

Never empty and never a bare error, because an empty tool result is the one
thing that reliably produces an invented citation. Four facts, the same four
``knowledge_search``'s empty message carries, in the source's own words:

1. what was actually SEARCHED: the planner's terms, not the user's words, so
   the model can see the rewrite it did not write;
2. which territory was assumed and WHERE THAT CAME FROM. A wrong jurisdiction
   is the commonest silent failure, and ``focus_entries`` drops other
   territories' law without saying so;
3. what matched but was not read, including the catalog's honest "not in the
   source" cases, the second of which hands the web tool its next move;
4. ONE concrete retry.

A document that was READ but answers nothing returns its headings, labelled as
an index rather than as evidence.
"""

from __future__ import annotations

from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.address import territory_sentence
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.trace import LookupTrace


def miss_message(question: str, address: Address, trace: LookupTrace, law: LawSource) -> str:
    """The four facts, in order, ending in one retry."""
    name = law.wording.source
    lines = [
        f"No {name} passage answered {question.strip()!r}.",
        f"Searched: {trace.searched or repr(question.strip())}"
        + (f" in {name} application {trace.collection}." if trace.collection else "."),
        territory_sentence(address, law),
    ]
    lines.extend(_as_of_lines(trace, law))
    lines.extend(_candidate_lines(trace))
    lines.extend(_headings_lines(trace, law))
    lines.append(_retry_line(address, trace, law))
    return "\n".join(lines)


def _as_of_lines(trace: LookupTrace, law: LawSource) -> list[str]:
    """On a past day, say that no version of that day was found, and that today's text was not substituted."""
    if not trace.as_of:
        return []
    if trace.fetched:
        return [
            f"Asked for the version in force on {trace.as_of}: {len(trace.fetched)} {law.wording.source} version "
            "document(s) of that day were read and none answered. Today's text is not given in their place."
        ]
    return [
        f"Asked for the version in force on {trace.as_of}: no {law.wording.source} version document of that day "
        f"was found ({trace.versions_dropped} hit(s) were versions of other days). Today's text is not given in "
        "its place; say the version of that day is not held, or call base-knowledge-edition-as-of for the edition."
    ]


def _candidate_lines(trace: LookupTrace) -> list[str]:
    """The documents that matched but were not read, with the reason."""
    unread = [candidate for candidate in trace.candidates if candidate.url not in trace.fetched]
    if not unread:
        return []
    return ["Matched but not read:"] + [
        f"  - {candidate.title or candidate.citation_url}: "
        f"{candidate.unavailable or candidate.citation_url or candidate.url}"
        for candidate in unread
    ]


def _headings_lines(trace: LookupTrace, law: LawSource) -> list[str]:
    """A fetched document with no answering provision returns its INDEX, not evidence."""
    if not trace.headings:
        return []
    return [
        "",
        f"The document was read; no {law.section_sign} in it answers the question. "
        "Its paragraphs (INDEX, not evidence):",
        *trace.headings,
    ]


def _retry_line(address: Address, trace: LookupTrace, law: LawSource) -> str:
    """ONE concrete retry, chosen by what is missing."""
    wording = law.wording
    if not address.territory:
        return f"Retry once: name the {wording.subdivision}, e.g. jurisdiction='{wording.example_territory}'."
    if not address.law and not trace.candidates:
        return f"Retry once: name the law, e.g. instrument='{wording.example_work}'."
    case_law = law.lookup.case_law()[:3]
    if case_law and (not trace.collection or trace.collection in law.lookup.consolidated()):
        others = "/".join(f"'{collection}'" for collection in case_law[1:])
        alternatives = f" (or {others})" if others else ""
        return f"Retry once with application='{case_law[0]}'{alternatives} if the answer is case law, not statute."
    return f"Retry once with a different statutory term in the question, or name the {law.section_sign} directly."
