"""A selected provision, as the thing a reader cites.

Everything a citation needs and nothing it does not: the work's short title,
the provision, the key the answer copies, the text, and an honest score. The
naming decisions made here each carry their reason in the function that makes
them: they are what the rest of the system reads a law source by.
"""

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

#: The doc_class every law passage carries. The producer KNOWS the class, and
#: stating it is what puts the hit in the statute lane instead of "unknown"
#: (``norm_registry.lane_for_hit`` reads doc_class first).
DOC_CLASS = "law"

#: What the ``Relevance Score:`` line means here. It is NOT a similarity: this
#: tool resolves an ADDRESS, it does not embed anything. A passage the caller
#: named scores :data:`SCORE_ADDRESSED`; a passage the picker ranked scores
#: :data:`SCORE_RANKED_TOP` minus its rank. The line is emitted because it is
#: also the header/body delimiter of the grounding grammar.
SCORE_ADDRESSED = 1.0
SCORE_RANKED_TOP = 0.9
SCORE_RANK_STEP = 0.05

#: What a LIST of named provisions may return in one call, all passages together.
#: One named provision gets SECTION_MAX_CHARS; six at that size were ~48k
#: characters in one tool result, re-sent with every later call of the turn.
LIST_MAX_CHARS = 2 * SECTION_MAX_CHARS


@dataclass(frozen=True)
class Passage:
    """One citable passage: what the reader gets and what the parser reads."""

    title: str
    url: str
    collection: str
    clause_label: str
    citation: str
    body: str
    score: float
    status_note: str = ""


def build_passages(selections: list[Selection], address: Address, law: LawSource) -> list[Passage]:
    """Render every selected provision into a citable passage."""
    # The list budget is per call, so it divides by the picks of EVERY document.
    limit = passage_limit(address, sum(len(selection.picks) for selection in selections))
    return [passage for selection in selections for passage in _passages_for(selection, address, limit, law)]


def _passages_for(selection: Selection, address: Address, limit: int, law: LawSource) -> list[Passage]:
    """The passages of ONE document, each cut to ``limit`` characters."""
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
            )
        )
    return out


def passage_limit(address: Address, picks: int) -> int:
    """Characters per passage: a named provision whole, a list sharing one budget, a ranked hit a chunk."""
    if not address.has_section:
        return PASSAGE_MAX_CHARS
    if len(address.sections) <= 1:
        return SECTION_MAX_CHARS
    # Never more than a single named provision gets: a list whose others the law lacks is one.
    return min(SECTION_MAX_CHARS, max(PASSAGE_MAX_CHARS, LIST_MAX_CHARS // max(picks, 1)))


def collection_for(candidate: Candidate, law: LawSource) -> str:
    """Where in the source this text came from, as a collection id: ``<namespace>/<collection>/<territory>``.

    Not a knowledge-base collection: the source is not one. It carries the same
    FACT the ``Collection:`` line carries for a corpus hit (which body of law
    this is), and the lanes read the doc_class, never this string.
    """
    parts = [law.namespace, candidate.collection]
    if candidate.territory:
        parts.append(candidate.territory)
    return "/".join(part for part in parts if part)


def citation_for(title: str, clause_label: str, version_date: str, law: LawSource) -> str:
    """``<short title>, § 63 Abs 1 (Fassung 2026-03-14)``: the key the answer copies.

    The version parenthetical is emitted ONLY when the source stated an
    in-force date for this document. A date in a page title is the RETRIEVAL
    stamp, not a version; in a citation key it would make the key change daily.
    """
    key = ", ".join(part for part in (title.strip(), clause_label.strip()) if part) or law.wording.untitled
    return f"{key} (Fassung {version_date})" if version_date else key


def title_noise(law: LawSource) -> tuple[re.Pattern[str], re.Pattern[str]]:
    """The source's title prefix (its own name) and its retrieval-date suffix, as regexes."""
    prefix, suffix = law.wording.title_prefix, law.wording.title_suffix
    prefix_re = rf"^\s*{re.escape(prefix)}\s*[-–—:]+\s*" if prefix else r"(?!)"
    words = r"\s+".join(re.escape(word) for word in suffix.split())
    suffix_re = rf"[,;]?\s*{words}\s+[\d.]+\s*$" if words else r"(?!)"
    return re.compile(prefix_re, re.IGNORECASE), re.compile(suffix_re, re.IGNORECASE)


def clean_title(raw: str, law: LawSource) -> str:
    """A title without the source's name before it and the retrieval stamp after it."""
    prefix, suffix = title_noise(law)
    return suffix.sub("", prefix.sub("", raw or ""))


def document_title(candidate: Candidate, document, law: LawSource) -> str:
    """The short title a citation names, without the retrieval stamp."""
    raw = candidate.title or document.title or ""
    return clean_title(raw, law).strip(" ,-–—") or law.wording.untitled


def score_for(rank: int, addressed: bool) -> float:
    """See :data:`SCORE_ADDRESSED`: a rank, stated honestly, not a similarity."""
    if addressed:
        return SCORE_ADDRESSED
    return max(0.5, SCORE_RANKED_TOP - rank * SCORE_RANK_STEP)
