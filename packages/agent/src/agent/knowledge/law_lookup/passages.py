from __future__ import annotations

import re
from dataclasses import dataclass

from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.candidates import Candidate
from agent.knowledge.law_lookup.extract import Selection
from agent.knowledge.law_lookup.sections import PASSAGE_MAX_CHARS
from agent.knowledge.law_lookup.sections import SECTION_MAX_CHARS
from agent.knowledge.law_lookup.sections import cut_on_subsection
from agent.knowledge.law_lookup.sections import subsection_body
from agent.knowledge.law_lookup.source import LawSource

DOC_CLASS = "law"

SCORE_ADDRESSED = 1.0
SCORE_RANKED_TOP = 0.9
SCORE_RANK_STEP = 0.05

LIST_MAX_CHARS = 2 * SECTION_MAX_CHARS


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


def build_passages(selections: list[Selection], address: Address, law: LawSource) -> list[Passage]:
    limit = passage_limit(address, sum(len(selection.picks) for selection in selections))
    return [passage for selection in selections for passage in _passages_for(selection, address, limit, law)]


def _passages_for(selection: Selection, address: Address, limit: int, law: LawSource) -> list[Passage]:
    candidate = selection.fetched.candidate
    document = selection.fetched.document
    title = document_title(candidate, document, law)
    status_note = (law.wording.consolidated_note if law.is_consolidated_url(document.url) else "") or ""
    collection = collection_for(candidate, law)
    out: list[Passage] = []
    for rank, (section, subsection) in enumerate(selection.picks):
        body, resolved = subsection_body(section, subsection, law.grammar)
        label = f"{section.label} {law.grammar.subsection_label} {resolved}" if resolved else section.label
        out.append(
            Passage(
                title=title,
                url=document.url,
                collection=collection,
                clause_label=label,
                citation=citation_for(title, label, candidate.version_date, law),
                body=cut_on_subsection(body, limit),
                score=score_for(rank, address.has_section),
                status_note=status_note,
                version_date=candidate.version_date,
            )
        )
    return out


def passage_limit(address: Address, picks: int) -> int:
    if not address.has_section:
        return PASSAGE_MAX_CHARS
    if len(address.sections) <= 1:
        return SECTION_MAX_CHARS
    return min(SECTION_MAX_CHARS, max(PASSAGE_MAX_CHARS, LIST_MAX_CHARS // max(picks, 1)))


def collection_for(candidate: Candidate, law: LawSource) -> str:
    parts = [law.namespace, candidate.collection or law.lookup.unplaced_collection]
    if candidate.territory:
        parts.append(candidate.territory)
    return "/".join(part for part in parts if part)


def citation_for(title: str, clause_label: str, version_date: str, law: LawSource) -> str:
    key = ", ".join(part for part in (title.strip(), clause_label.strip()) if part) or law.wording.untitled
    return f"{key} (Fassung {version_date})" if version_date else key


def title_noise(law: LawSource) -> tuple[re.Pattern[str], re.Pattern[str]]:
    prefix, suffix = law.wording.title_prefix, law.wording.title_suffix
    prefix_re = rf"^\s*{re.escape(prefix)}\s*[-–—:]+\s*" if prefix else r"(?!)"
    words = r"\s+".join(re.escape(word) for word in suffix.split())
    suffix_re = rf"[,;]?\s*{words}\s+[\d.]+\s*$" if words else r"(?!)"
    return re.compile(prefix_re, re.IGNORECASE), re.compile(suffix_re, re.IGNORECASE)


def clean_title(raw: str, law: LawSource) -> str:
    prefix, suffix = title_noise(law)
    return suffix.sub("", prefix.sub("", raw or ""))


def document_title(candidate: Candidate, document, law: LawSource) -> str:
    raw = candidate.title or document.title or ""
    return clean_title(raw, law).strip(" ,-–—") or law.wording.untitled


def score_for(rank: int, addressed: bool) -> float:
    if addressed:
        return SCORE_ADDRESSED
    return max(0.5, SCORE_RANKED_TOP - rank * SCORE_RANK_STEP)
