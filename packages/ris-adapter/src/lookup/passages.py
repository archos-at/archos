from __future__ import annotations

from dataclasses import dataclass

from ris_adapter.lookup.address import Address
from ris_adapter.lookup.candidates import Candidate
from ris_adapter.lookup.extract import Selection
from ris_adapter.lookup.grammar import PASSAGE_MAX_CHARS
from ris_adapter.lookup.grammar import SECTION_MAX_CHARS
from ris_adapter.lookup.grammar import cut_on_subsection
from ris_adapter.lookup.grammar import subsection_body
from ris_adapter.register import _RIS_TITLE_PREFIX_RE
from ris_adapter.register import _RIS_TITLE_REVISION_RE
from ris_adapter.register import _legal_status_note

DOC_CLASS = "law"

SCORE_ADDRESSED = 1.0
SCORE_RANKED_TOP = 0.9
SCORE_RANK_STEP = 0.05


@dataclass(frozen=True)
class Passage:

    title: str
    url: str
    collection: str
    clause_label: str
    citation: str
    body: str
    score: float
    status_note: str = ""
    version_date: str = ""


def build_passages(selections: list[Selection], address: Address) -> list[Passage]:
    limit = _passage_limit(address, sum(len(selection.picks) for selection in selections))
    return [passage for selection in selections for passage in _passages_for(selection, address, limit)]


def _passages_for(selection: Selection, address: Address, limit: int) -> list[Passage]:
    candidate = selection.fetched.candidate
    document = selection.fetched.document
    title = document_title(candidate, document)
    status_note = _legal_status_note(document.url) or ""
    collection = collection_for(candidate)
    out: list[Passage] = []
    for rank, (section, subsection) in enumerate(selection.picks):
        body, resolved = subsection_body(section, subsection)
        label = f"{section.label} Abs {resolved}" if resolved else section.label
        out.append(
            Passage(
                title=title,
                url=document.url,
                collection=collection,
                clause_label=label,
                citation=citation_for(title, label, candidate.version_date),
                body=cut_on_subsection(body, limit),
                score=score_for(rank, address.has_section),
                status_note=status_note,
                version_date=candidate.version_date,
            )
        )
    return out


LIST_MAX_CHARS = 2 * SECTION_MAX_CHARS


def _passage_limit(address: Address, picks: int) -> int:
    if not address.has_section:
        return PASSAGE_MAX_CHARS
    if len(address.sections) <= 1:
        return SECTION_MAX_CHARS
    return min(SECTION_MAX_CHARS, max(PASSAGE_MAX_CHARS, LIST_MAX_CHARS // max(picks, 1)))


def collection_for(candidate: Candidate) -> str:
    parts = ["ris", candidate.application or "kons"]
    if candidate.federal_state:
        parts.append(candidate.federal_state)
    return "/".join(parts)


def citation_for(title: str, clause_label: str, version_date: str) -> str:
    key = ", ".join(part for part in (title.strip(), clause_label.strip()) if part) or "RIS-Dokument"
    return f"{key} (Fassung {version_date})" if version_date else key


def document_title(candidate: Candidate, document) -> str:
    raw = candidate.title or document.title or ""
    return _RIS_TITLE_REVISION_RE.sub("", _RIS_TITLE_PREFIX_RE.sub("", raw)).strip(" ,-–—") or "RIS-Dokument"


def score_for(rank: int, addressed: bool) -> float:
    if addressed:
        return SCORE_ADDRESSED
    return max(0.5, SCORE_RANKED_TOP - rank * SCORE_RANK_STEP)
