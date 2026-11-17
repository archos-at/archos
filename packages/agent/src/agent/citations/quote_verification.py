from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from collections.abc import Sequence
from dataclasses import dataclass

from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.citations.markdown_code import code_spans
from agent.citations.markdown_code import inside
from agent.citations.quote_matching import MIN_QUOTE_LEN
from agent.citations.quote_matching import QUOTE_MATCH_THRESHOLD
from agent.citations.quote_matching import QUOTED_SPAN_RE
from agent.citations.quote_matching import UnverifiedQuote
from agent.citations.quote_matching import normalize_for_quote_match
from agent.citations.quote_matching import normalized_closeness
from agent.citations.quote_matching import normalized_coverage
from agent.citations.references import CITATION_LINE_RE
from agent.citations.references import INLINE_CITATION_RE
from agent.citations.references import REFERENCE_SECTION_RE
from agent.citations.references import document_identity
from agent.citations.registry import SourceRegistry
from agent.citations.report_layout import ORIGIN_TOKEN_RE
from agent.citations.report_layout import normalize_citation_syntax
from agent.citations.verification import resolve_source_line

logger = logging.getLogger(__name__)


QUOTE_MAX_WORDS = 40


_QUOTE_SENTENCE_END_RE = re.compile(r"(?<!\d)\.(?!\d)|[!?…]|\n")


def _quote_sentence_windows(body: str, start: int, end: int) -> tuple[tuple[int, int], tuple[int, int] | None]:
    ends = list(_QUOTE_SENTENCE_END_RE.finditer(body))
    win_start = 0
    for match in ends:
        if match.end() <= start:
            win_start = match.end()
        else:
            break
    win_end = len(body)
    following: tuple[int, int] | None = None
    for match in ends:
        if match.start() >= end:
            win_end = match.start()
            after = next((later for later in ends if later.start() >= match.end()), None)
            following = (match.end(), after.start() if after is not None else len(body))
            break
    return (win_start, win_end), following


def _quote_cited_numbers(body: str, start: int, end: int) -> set[int]:
    (win_start, win_end), following = _quote_sentence_windows(body, start, end)
    numbers = {int(n) for n in INLINE_CITATION_RE.findall(body, win_start, win_end)}
    if not numbers and following is not None:
        numbers = {int(n) for n in INLINE_CITATION_RE.findall(body, following[0], following[1])}
    return numbers


@dataclass(frozen=True)
class _CitedSources:

    documents: frozenset[tuple[str | None, str]] = frozenset()
    urls: frozenset[str] = frozenset()

    def holds(self, source: SourceEntry) -> bool:
        if document_identity(source) in self.documents:
            return True
        return bool(source.url) and normalize_url(source.url or "") in self.urls


class _CitedLookup:

    def __init__(self, answer_text: str, registry: SourceRegistry) -> None:
        self._answer_text = answer_text
        self._registry = registry
        self._lines: dict[int, list[str]] | None = None
        self._memo: dict[frozenset[int], _CitedSources] = {}

    def _source_lines(self) -> dict[int, list[str]]:
        if self._lines is None:
            normalized = normalize_citation_syntax(self._answer_text)
            section = REFERENCE_SECTION_RE.search(normalized)
            self._lines = {}
            if section is not None:
                for number, text in CITATION_LINE_RE.findall(normalized[section.start() :]):
                    self._lines.setdefault(int(number), []).append(text)
        return self._lines

    def __call__(self, numbers: set[int]) -> _CitedSources:
        key = frozenset(numbers)
        if key not in self._memo:
            lines = [line for number in sorted(key) for line in self._source_lines().get(number, ())]
            self._memo[key] = self._resolve(lines)
        return self._memo[key]

    def _resolve(self, lines: Sequence[str]) -> _CitedSources:
        documents: set[tuple[str | None, str]] = set()
        urls: set[str] = set()
        for line in lines:
            text = line.strip()
            token = ORIGIN_TOKEN_RE.match(text)
            source = resolve_source_line(text[token.end() :] if token else text, self._registry)
            if source.url:
                urls.add(normalize_url(source.url))
            elif (entry := source.entry(self._registry)) is not None:
                documents.add(document_identity(entry))
        return _CitedSources(frozenset(documents), frozenset(urls))


def _nearest_cited(
    norm_quote: str, cited: _CitedSources, normalized_chunks: Sequence[tuple[str, SourceEntry]]
) -> tuple[SourceEntry | None, float]:
    best, nearest = -1.0, None
    for chunk, source in normalized_chunks:
        if not cited.holds(source):
            continue
        score = normalized_closeness(norm_quote, chunk)
        if score > best:
            best, nearest = score, source
    return nearest, max(best, 0.0)


def _flag_reason(too_long: bool, uncited: bool) -> str:
    return "+".join(name for name, hit in (("too_long", too_long), ("uncited", uncited)) if hit) or "not_verbatim"


def _answer_body_before_sources(answer_text: str) -> str:
    ref_match = REFERENCE_SECTION_RE.search(answer_text)
    return answer_text[: ref_match.start()] if ref_match else answer_text


def _quoted_spans(body: str, min_quote_len: int) -> Iterator[tuple[re.Match[str], str, str]]:
    code = code_spans(body)
    for match in QUOTED_SPAN_RE.finditer(body):
        if inside(match.start(), code):
            continue
        inner = next((group for group in match.groups() if group is not None), None)
        if inner is None:
            continue
        norm_quote = normalize_for_quote_match(inner)
        if len(norm_quote) >= min_quote_len:
            yield match, inner, norm_quote


def _verification_chunks(registry: SourceRegistry) -> list[tuple[str, SourceEntry]]:
    licensed = getattr(registry, "licensed_text", {})
    return [
        (norm, source)
        for source in registry.all_sources()
        if (text := licensed.get(source.citation_key) or source.chunk_text)
        if (norm := normalize_for_quote_match(text))
    ]


def verify_quoted_spans(
    answer_text: str,
    registry: SourceRegistry,
    *,
    threshold: float = QUOTE_MATCH_THRESHOLD,
    min_quote_len: int = MIN_QUOTE_LEN,
    with_nearest: bool = True,
) -> list[UnverifiedQuote]:
    body = _answer_body_before_sources(answer_text)
    normalized_chunks = _verification_chunks(registry)
    if not normalized_chunks:
        return []

    cited_lookup = _CitedLookup(answer_text, registry)
    unverified: list[UnverifiedQuote] = []
    for match, inner, norm_quote in _quoted_spans(body, min_quote_len):
        too_long = len(inner.split()) > QUOTE_MAX_WORDS
        cited_numbers = _quote_cited_numbers(body, match.start(), match.end())
        uncited = not cited_numbers
        best_coverage = max(normalized_coverage(norm_quote, chunk) for chunk, _ in normalized_chunks)
        if not (too_long or uncited or best_coverage < threshold):
            continue
        nearest, score = None, 0.0
        if with_nearest and not (too_long or uncited):
            nearest, score = _nearest_cited(norm_quote, cited_lookup(cited_numbers), normalized_chunks)
        unverified.append(
            UnverifiedQuote(
                quote=inner,
                span=match.group(0),
                start=match.start(),
                end=match.end(),
                best_coverage=best_coverage,
                reason=_flag_reason(too_long, uncited),
                nearest=nearest,
                nearest_closeness=score,
            )
        )
    return unverified
