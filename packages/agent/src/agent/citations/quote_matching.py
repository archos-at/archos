from __future__ import annotations

import difflib
import logging
import re
import unicodedata
from dataclasses import dataclass
from dataclasses import field

from agent.citations.entries import SourceEntry
from agent.common.quote_polarity import polarity_agrees

logger = logging.getLogger(__name__)


QUOTE_MATCH_THRESHOLD = 0.90


MIN_QUOTE_LEN = 20


_QUOTE_WINDOW_PAD_MIN = 4


_QUOTE_MAX_ELIDED_GAP = 6


_WHOLE_WORD_RE = re.compile(r"(?<![^\W\d_])[^\W\d_]{3,}(?![^\W\d_])")


def _skips_a_word(text: str) -> bool:
    return bool(text) and _WHOLE_WORD_RE.search(text) is not None


QUOTED_SPAN_RE = re.compile(
    r"„([^„“”\"]+)[“”\"]"  # German low-9 opening; closing „…“/„…”/„…" (models mix them)
    r"|»([^»«]+)«"  # guillemets
    r"|“([^“”]+)”"  # curly double
    r"|\"([^\"]+)\""  # ASCII straight
)


_QUOTE_EDGE_CHARS = "„“”»«\"'‚‘’ "


@dataclass
class UnverifiedQuote:

    quote: str
    span: str
    start: int
    end: int
    best_coverage: float
    reason: str = "not_verbatim"
    nearest: SourceEntry | None = field(default=None, compare=False, repr=False)
    nearest_closeness: float = field(default=0.0, compare=False)


def normalize_for_quote_match(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"-\n", "", text)
    text = re.sub(r"(?m)^[ \t]*>[ \t]?", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip(_QUOTE_EDGE_CHARS)
    return text.casefold()


def normalized_coverage(norm_quote: str, norm_chunk: str) -> float:
    quote_len = len(norm_quote)
    if quote_len == 0:
        return 0.0
    pad = max(_QUOTE_WINDOW_PAD_MIN, quote_len // 10)
    window_len = quote_len + pad
    base = difflib.SequenceMatcher(None, norm_quote, norm_chunk, autojunk=False)
    window_starts = {max(0, block.b - block.a) for block in base.get_matching_blocks() if block.size}
    if not window_starts:
        return 0.0
    best = 0.0
    for start in window_starts:
        window = norm_chunk[max(0, start - pad) : start + window_len]
        matcher = difflib.SequenceMatcher(None, norm_quote, window, autojunk=False)
        run = 0
        best_run = 0
        elided = 0
        prev_a_end: int | None = None
        prev_b_end: int | None = None
        run_start = (0, 0)
        best_span = (0, 0, 0, 0)
        for block in matcher.get_matching_blocks():
            if not block.size:
                continue
            if prev_b_end is not None:
                chunk_gap = block.b - prev_b_end
                quote_gap = block.a - prev_a_end
                elided += max(0, chunk_gap - quote_gap)
                edited = _skips_a_word(window[prev_b_end : block.b]) or _skips_a_word(norm_quote[prev_a_end : block.a])
                if elided > _QUOTE_MAX_ELIDED_GAP or edited:
                    run = 0
                    elided = 0
            if run == 0:
                run_start = (block.a, block.b)
            run += block.size
            if run > best_run:
                best_run = run
                best_span = (*run_start, block.a + block.size, block.b + block.size)
            prev_a_end = block.a + block.size
            prev_b_end = block.b + block.size
        score = best_run / quote_len
        if score >= QUOTE_MATCH_THRESHOLD and not _aligned_polarity_agrees(norm_quote, window, best_span):
            score = 0.0
        best = max(best, score)
    return best


def _aligned_polarity_agrees(norm_quote: str, window: str, span: tuple[int, int, int, int]) -> bool:
    a_start, b_start, a_end, b_end = span
    start = max(0, b_start - a_start)
    end = min(len(window), b_end + (len(norm_quote) - a_end))
    return polarity_agrees(norm_quote, _whole_words(window, start, end))


def _whole_words(text: str, start: int, end: int) -> str:
    while start > 0 and text[start - 1].isalpha():
        start -= 1
    while end < len(text) and text[end].isalpha():
        end += 1
    return text[start:end]


def quote_coverage(quote: str, passage: str) -> float:
    return normalized_coverage(normalize_for_quote_match(quote), normalize_for_quote_match(passage))


def closeness(quote: str, passage: str) -> float:
    return normalized_closeness(normalize_for_quote_match(quote), normalize_for_quote_match(passage))


def normalized_closeness(norm_quote: str, norm_passage: str) -> float:
    length = len(norm_quote)
    if not length or not norm_passage:
        return 0.0
    step, width, best = max(1, length // 8), length + length // 5, 0.0
    for start in range(0, max(1, len(norm_passage) - length + step), step):
        matcher = difflib.SequenceMatcher(None, norm_quote, norm_passage[start : start + width])
        if matcher.real_quick_ratio() > best and matcher.quick_ratio() > best:
            best = max(best, matcher.ratio())
    return best
