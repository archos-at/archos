from __future__ import annotations

from ris_adapter.lookup.address import Address
from ris_adapter.lookup.address import federal_state_sentence
from ris_adapter.lookup.trace import LookupTrace
from ris_adapter.register import _KONSOLIDIERT_APPLICATIONS


def miss_message(question: str, address: Address, trace: LookupTrace) -> str:
    lines = [
        f"No RIS passage answered {question.strip()!r}.",
        f"Searched: {trace.searched or repr(question.strip())}"
        + (f" in RIS application {trace.application}." if trace.application else "."),
        federal_state_sentence(address),
    ]
    lines.extend(_as_of_lines(trace))
    lines.extend(_candidate_lines(trace))
    lines.extend(_headings_lines(trace))
    lines.append(_retry_line(address, trace))
    return "\n".join(lines)


def _as_of_lines(trace: LookupTrace) -> list[str]:
    if not trace.as_of:
        return []
    return [
        f"Asked for the version in force on {trace.as_of}: no RIS version document of that day was found "
        f"({trace.versions_dropped} hit(s) were versions of other days). Today's text is not given in its place; "
        "say the version of that day is not held, or call base-knowledge-edition-as-of for the edition."
    ]


def _candidate_lines(trace: LookupTrace) -> list[str]:
    unread = [candidate for candidate in trace.candidates if candidate.url not in trace.fetched]
    if not unread:
        return []
    return ["Matched but not read:"] + [
        f"  - {candidate.title or candidate.citation_url}: "
        f"{candidate.unavailable or candidate.citation_url or candidate.url}"
        for candidate in unread
    ]


def _headings_lines(trace: LookupTrace) -> list[str]:
    if not trace.headings:
        return []
    return [
        "",
        "The document was read; no § in it answers the question. Its paragraphs (INDEX, not evidence):",
        *trace.headings,
    ]


def _retry_line(address: Address, trace: LookupTrace) -> str:
    if not address.federal_state:
        return "Retry once: name the Bundesland, e.g. jurisdiction='Wien'."
    if not address.law and not trace.candidates:
        return "Retry once: name the law, e.g. instrument='Bauordnung für Wien'."
    if not trace.application or trace.application in _KONSOLIDIERT_APPLICATIONS:
        return "Retry once with application='Vwgh' (or 'Vfgh'/'Justiz') if the answer is case law, not statute."
    return "Retry once with a different statutory term in the question, or name the § directly."
