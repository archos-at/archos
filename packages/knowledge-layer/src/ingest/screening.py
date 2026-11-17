from __future__ import annotations

import json
from bisect import bisect_right
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Literal

from agent.common.card_numbers import luhn_valid
from agent.common.card_numbers import mask_card
from agent.common.card_numbers import valid_card
from agent.common.content_screen import DETECTORS
from agent.common.content_screen import IBAN_LENGTHS
from agent.common.content_screen import MAX_TERM_CHARS
from agent.common.content_screen import MAX_TERMS
from agent.common.content_screen import MIN_TERM_CHARS
from agent.common.content_screen import Detector
from agent.common.content_screen import ScreeningRules
from agent.common.content_screen import Span
from agent.common.content_screen import find_spans
from agent.common.content_screen import fold
from agent.common.content_screen import mask_iban
from agent.common.content_screen import valid_iban
from agent.common.page_text import running_furniture
from agent.common.page_text import without_furniture
from agent.common.svnr_numbers import mask_at_svnr
from agent.common.svnr_numbers import valid_at_svnr
from agent.knowledge.schema import QuarantineReason
from agent.knowledge.schema import QuarantineVerdict

__all__ = [
    "DETECTORS",
    "IBAN_LENGTHS",
    "MAX_ERROR_CHARS",
    "MAX_REASON_PAGES",
    "MAX_REASONS",
    "MAX_TERM_CHARS",
    "MAX_TERMS",
    "MIN_TERM_CHARS",
    "QUARANTINED_PREFIX",
    "Detector",
    "Reason",
    "ScreeningRules",
    "ScreeningVerdict",
    "document_pages",
    "fold",
    "log_summary",
    "luhn_valid",
    "mask_at_svnr",
    "mask_card",
    "mask_iban",
    "page_number_of",
    "quarantine_error",
    "screen_pages",
    "valid_at_svnr",
    "valid_card",
    "valid_iban",
]

QUARANTINED_PREFIX = "quarantined:"

MAX_REASON_PAGES = 50
MAX_REASONS = 10
MAX_ERROR_CHARS = 2000




@dataclass(frozen=True)
class Reason:

    kind: str
    count: int
    pages: list[int]
    term: str | None = None
    sample: str | None = None
    pages_truncated: bool = False

    def to_model(self) -> QuarantineReason:
        return QuarantineReason(
            kind=self.kind,
            term=self.term,
            count=self.count,
            pages=list(self.pages),
            pages_truncated=self.pages_truncated,
            sample=self.sample,
        )

    def as_json(self) -> dict[str, object]:
        return self.to_model().model_dump()


@dataclass(frozen=True)
class ScreeningVerdict:

    reasons: list[Reason] = field(default_factory=list)
    checked: Literal["full", "partial"] = "full"
    after_transcription: bool = False

    @property
    def matched(self) -> bool:
        return bool(self.reasons)

    def to_model(self) -> QuarantineVerdict:
        listed = list(self.reasons[:MAX_REASONS])
        while True:
            model = QuarantineVerdict(
                reasons=[reason.to_model() for reason in listed],
                checked=self.checked,
                omitted=len(self.reasons) - len(listed),
                after_transcription=self.after_transcription,
            )
            if len(QUARANTINED_PREFIX) + len(_compact_json(model)) <= MAX_ERROR_CHARS or not listed:
                return model
            listed = _with_one_page_fewer(listed) or listed[:-1]


@dataclass
class _Tally:
    count: int = 0
    pages: set[int] = field(default_factory=set)
    sample: str | None = None

    def add(self, hits: int, pages: Iterable[int | None], sample: str | None = None) -> None:
        if not hits:
            return
        self.count += hits
        self.pages.update(page for page in pages if page is not None)
        if self.sample is None:
            self.sample = sample


def screen_pages(
    pages: Iterable[tuple[int | None, str]],
    rules: ScreeningRules,
    *,
    checked: Literal["full", "partial"] = "full",
    stream: Sequence[tuple[int, str]] = (),
) -> ScreeningVerdict:
    term_tallies = {term: _Tally() for term in rules.terms}
    detector_tallies = {name: _Tally() for name in rules.detectors}
    found = [(span, (page,)) for page, text in pages for span in find_spans(text, rules)]
    found += _spans_across_pages(stream, rules)
    for span, span_pages in found:
        tally = term_tallies[span.term] if span.kind == "term" else detector_tallies[span.kind]
        tally.add(1, span_pages, span.sample)
    reasons = [
        Reason(
            kind="term",
            term=term,
            count=tally.count,
            pages=_page_list(tally.pages),
            pages_truncated=len(tally.pages) > MAX_REASON_PAGES,
        )
        for term, tally in term_tallies.items()
        if tally.count
    ]
    reasons += [
        Reason(
            kind=name,
            count=tally.count,
            pages=_page_list(tally.pages),
            sample=tally.sample,
            pages_truncated=len(tally.pages) > MAX_REASON_PAGES,
        )
        for name, tally in detector_tallies.items()
        if tally.count
    ]
    return ScreeningVerdict(reasons=reasons, checked=checked)


def _spans_across_pages(stream: Sequence[tuple[int, str]], rules: ScreeningRules) -> list[tuple[Span, tuple[int, ...]]]:
    if len(stream) < 2:
        return []
    page_lines = [text.split("\n") for _, text in stream]
    furniture = running_furniture(page_lines)
    bodies = ["\n".join(without_furniture(lines, furniture)) for lines in page_lines]
    starts: list[int] = []
    offset = 0
    for body in bodies:
        starts.append(offset)
        offset += len(body) + 1
    numbers = [page for page, _ in stream]

    def page_index(position: int) -> int:
        return bisect_right(starts, position) - 1

    across: list[tuple[Span, tuple[int, ...]]] = []
    for span in find_spans("\n".join(bodies), rules):
        first, last = page_index(span.start), page_index(span.end - 1)
        if first != last:
            across.append((span, tuple(numbers[first : last + 1])))
    return across


def _page_list(pages: set[int]) -> list[int]:
    return sorted(pages)[:MAX_REASON_PAGES]


def page_number_of(label: object) -> int | None:
    if isinstance(label, bool):
        return None
    if isinstance(label, int):
        return label
    if isinstance(label, str) and label.strip().isdigit():
        return int(label.strip())
    return None


def document_pages(documents: Iterable[object]) -> list[tuple[int | None, str]]:
    pages: list[tuple[int | None, str]] = []
    for document in documents:
        metadata = getattr(document, "metadata", None) or {}
        pages.append((page_number_of(metadata.get("page_label")), getattr(document, "text", "") or ""))
    return pages


def quarantine_error(verdict: ScreeningVerdict) -> str:
    return QUARANTINED_PREFIX + _compact_json(verdict.to_model())


def _compact_json(model: QuarantineVerdict) -> str:
    return json.dumps(model.model_dump(), ensure_ascii=False, separators=(",", ":"))


def _with_one_page_fewer(reasons: list[Reason]) -> list[Reason] | None:
    widest = max(range(len(reasons)), key=lambda index: len(reasons[index].pages))
    pages = reasons[widest].pages
    if len(pages) < 2:
        return None
    trimmed = list(reasons)
    trimmed[widest] = replace(reasons[widest], pages=pages[:-1], pages_truncated=True)
    return trimmed


def log_summary(verdict: ScreeningVerdict) -> str:
    return ", ".join(f"{reason.kind}={reason.count}" for reason in verdict.reasons)
