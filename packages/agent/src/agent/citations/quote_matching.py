"""Whether a quoted span is in a passage: normalisation, coverage and closeness."""

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
    """True when ``text`` (a skipped or inserted run, already casefolded) holds a whole word.

    The run's own edges count as word boundaries: a gap of exactly ``"nicht "``
    is the whole word, and the character before it belongs to a matched block
    that is by construction the same in quote and passage.
    """
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
    """A quoted span in the answer body that no source chunk text supports."""

    quote: str
    span: str
    start: int
    end: int
    best_coverage: float
    reason: str = "not_verbatim"
    nearest: SourceEntry | None = field(default=None, compare=False, repr=False)
    nearest_closeness: float = field(default=0.0, compare=False)


def normalize_for_quote_match(text: str) -> str:
    """Normalize a quote or chunk body for fuzzy comparison.

    Applies (in order): Unicode NFKC; join hyphenated line-wraps (``Bau-\\nordnung``
    → ``Bauordnung``); strip leading blockquote ``> `` markers; collapse all
    whitespace to single spaces; strip surrounding quote marks; ``casefold()``.
    Both the quoted span and each source chunk text pass through this so the
    comparison ignores formatting, OCR line-wrapping and casing differences.
    """
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"-\n", "", text)
    text = re.sub(r"(?m)^[ \t]*>[ \t]?", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip(_QUOTE_EDGE_CHARS)
    return text.casefold()


def normalized_coverage(norm_quote: str, norm_chunk: str) -> float:
    """Fraction of ``norm_quote`` covered by a CONTIGUOUS-enough run of the chunk.

    Two earlier metrics were both defeatable:

    - A whole-chunk subsequence match (sum of every matching block, anywhere in
      the chunk) scored a phrase-splice — real fragments pulled from DIFFERENT
      clauses — at 1.0 even though the quote is not a substring.
    - Restricting the sum to a single window sized to the quote length still let
      an ADJACENT-clause splice through: when the quote merges two neighbouring
      sentences (dropping a short connective), the whole spliced span is about as
      long as the quote, so it fits one window and the summed blocks stay above
      threshold — even though the quote skipped over real chunk text in between.

    The fix penalizes NON-CONTIGUITY directly. Within each candidate window we
    walk the matching blocks in order and accumulate the NET chunk text the quote
    skips between consecutive blocks (``chunk_gap - quote_gap``, floored at 0 so a
    same-length substitution — the shape of OCR/casing noise — costs ~nothing).
    Once that cumulative elision exceeds an ABSOLUTE budget
    (``_QUOTE_MAX_ELIDED_GAP``) the region is cut and a fresh run begins; the
    score is the longest single run divided by ``len(quote)``.

    - A genuine verbatim quote is one uninterrupted run → ~1.0. Light
      OCR/whitespace/hyphenation/„…"-mark noise perturbs the alignment by only a
      char or two at a time and nets far under budget, so it too scores ~1.0.
    - A splice — adjacent OR scattered, short gap OR long — leaves an elided run
      of chunk text with no quote counterpart; the budget is exceeded, the region
      is split, and no surviving run reaches the threshold → low score.

    The budget is a fixed constant rather than a fraction of the quote, so a
    longer quote can no longer buy a proportionally larger silent elision.
    Candidate windows are anchored at the diagonals of the matching blocks
    (window start = ``block.b - block.a``), so only a handful are scored per
    quote×chunk. Pure stdlib (``difflib``), fail-open, and cheap.
    """
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
    """Whether the whole quote and the passage stretch it aligns to negate the same things.

    ``span`` is ``(quote start, window start, quote end, window end)`` of the
    best run. The passage side is the run widened by whatever of the quote the
    run left unmatched at either end, then to whole words, so a run that stops
    inside „keine" compares the whole word.
    """
    a_start, b_start, a_end, b_end = span
    start = max(0, b_start - a_start)
    end = min(len(window), b_end + (len(norm_quote) - a_end))
    return polarity_agrees(norm_quote, _whole_words(window, start, end))


def _whole_words(text: str, start: int, end: int) -> str:
    """``text[start:end]`` widened left and right to the nearest word boundary."""
    while start > 0 and text[start - 1].isalpha():
        start -= 1
    while end < len(text) and text[end].isalpha():
        end += 1
    return text[start:end]


def quote_coverage(quote: str, passage: str) -> float:
    """How much of ``quote`` one contiguous run of ``passage`` holds (0-1): the verifier's own test.

    :func:`normalized_coverage` on raw text. A quote at or above
    ``QUOTE_MATCH_THRESHOLD`` is one the prose may keep between quote marks,
    and the same bar is what stamps a quote line „Wortlaut belegt"
    (``common/quote_stamps.py``).
    """
    return normalized_coverage(normalize_for_quote_match(quote), normalize_for_quote_match(passage))


def closeness(quote: str, passage: str) -> float:
    """How closely ``quote`` matches the most similar stretch of ``passage`` (0-1).

    Not the verifier's coverage, which scores the longest CONTIGUOUS run and
    so drops a quote with two words changed to ~0.4, the same as an invented
    one. This compares the quote with each quote-sized window of the passage
    and keeps the best ratio, so scattered small edits cost little and a
    different sentence costs a lot. What the quote patch gates on
    (``quote_patch.PATCH_FLOOR``), and what picks the passage it patches from.
    """
    return normalized_closeness(normalize_for_quote_match(quote), normalize_for_quote_match(passage))


def normalized_closeness(norm_quote: str, norm_passage: str) -> float:
    """:func:`closeness` on text already through :func:`normalize_for_quote_match`."""
    length = len(norm_quote)
    if not length or not norm_passage:
        return 0.0
    step, width, best = max(1, length // 8), length + length // 5, 0.0
    for start in range(0, max(1, len(norm_passage) - length + step), step):
        matcher = difflib.SequenceMatcher(None, norm_quote, norm_passage[start : start + width])
        if matcher.real_quick_ratio() > best and matcher.quick_ratio() > best:
            best = max(best, matcher.ratio())
    return best
