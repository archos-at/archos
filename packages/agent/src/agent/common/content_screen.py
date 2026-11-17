from __future__ import annotations

import logging
import math
import re
import unicodedata
from bisect import bisect_left
from bisect import bisect_right
from collections.abc import Iterable
from collections.abc import Iterator
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Literal

from agent.common.card_numbers import CARD_CONTEXT_WORDS
from agent.common.card_numbers import CARD_PAGE_LABELS
from agent.common.card_numbers import cards_in
from agent.common.card_numbers import context_window
from agent.common.card_numbers import has_word
from agent.common.card_numbers import mask_card
from agent.common.card_numbers import wrapped_card_layout
from agent.common.de_numbers import TAX_ID_LABELS
from agent.common.de_numbers import de_svnr_at
from agent.common.de_numbers import de_tax_id_at
from agent.common.de_numbers import mask_de_svnr
from agent.common.de_numbers import mask_de_tax_id
from agent.common.screen_chars import _HORIZONTAL_SPACE
from agent.common.screen_chars import _LINE_BREAKS
from agent.common.screen_chars import WHITESPACE
from agent.common.screen_chars import _digit_at
from agent.common.screen_chars import _digit_touches
from agent.common.screen_chars import _digits_at
from agent.common.screen_chars import _is_letter
from agent.common.screen_chars import _is_mark
from agent.common.screen_chars import _is_word_char
from agent.common.screen_chars import _skip_separator
from agent.common.svnr_numbers import SVNR_LABELS
from agent.common.svnr_numbers import mask_at_svnr
from agent.common.svnr_numbers import printed_as_svnr
from agent.common.svnr_numbers import valid_at_svnr

logger = logging.getLogger(__name__)

Detector = Literal["iban", "at_svnr", "credit_card", "de_svnr", "de_tax_id"]
DETECTORS: tuple[str, ...] = ("iban", "at_svnr", "credit_card", "de_svnr", "de_tax_id")

MAX_TERMS = 200
MIN_TERM_CHARS = 2
MAX_TERM_CHARS = 80

MASK = "••••"

PLACEHOLDERS: dict[str, str] = {
    "iban": "[IBAN entfernt]",
    "at_svnr": "[SV-Nummer entfernt]",
    "credit_card": "[Kartennummer entfernt]",
    "de_svnr": "[RV-Nummer entfernt]",
    "de_tax_id": "[Steuer-ID entfernt]",
    "term": "[Begriff entfernt]",
}

_PLACEHOLDER_RE = re.compile("|".join(re.escape(placeholder) for placeholder in PLACEHOLDERS.values()))



_SPACE_RUN = re.compile(f"[{WHITESPACE}]+")

_FOLD_TABLE = str.maketrans({"ς": "σ", "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def _split_words(text: str) -> list[str]:
    return [word for word in _SPACE_RUN.split(text) if word]



IGNORABLE = "\u00ad\u200b\u200c\u200d\u2060\ufeff"
_BREAK_HYPHENS = "-\u2010\u2011"


_DROP_SITE = re.compile(f"[{_BREAK_HYPHENS}{IGNORABLE}]")  # the ASCII hyphen first: not a range


@dataclass(frozen=True)
class _Reading:

    text: str
    starts: list[int] | None = None
    soft: frozenset[int] = frozenset()

    def original(self, start: int, end: int) -> tuple[int, int]:
        if self.starts is None:
            return start, end
        return self.starts[start], self.starts[end - 1] + 1


def _line_break_at(text: str, index: int) -> int:
    if text.startswith("\r\n", index):
        return index + 2
    return index + 1 if index < len(text) and text[index] in _LINE_BREAKS else index


def _skip(text: str, index: int, chars: str) -> int:
    while index < len(text) and text[index] in chars:
        index += 1
    return index


def _hyphenation_end(text: str, index: int, before: str) -> int:
    if not before or not _is_word_char(before):
        return index
    cursor = _skip(text, index + 1, _HORIZONTAL_SPACE + IGNORABLE)
    broken = _line_break_at(text, cursor)
    if broken == cursor:
        return index
    broken = _skip(text, broken, _HORIZONTAL_SPACE + IGNORABLE)
    return broken if broken < len(text) and _is_word_char(text[broken]) else index


def _read(text: str) -> _Reading:
    if not _DROP_SITE.search(text):
        return _Reading(text)
    parts: list[str] = []
    starts: list[int] = []
    soft: set[int] = set()
    cursor = 0
    before = ""
    for match in _DROP_SITE.finditer(text):
        index = match.start()
        if index < cursor:
            continue
        if index > cursor:
            parts.append(text[cursor:index])
            starts.extend(range(cursor, index))
            before = text[index - 1]
        cursor = index + 1
        if text[index] in IGNORABLE:
            soft.add(len(starts))
            continue
        end = _hyphenation_end(text, index, before)
        if end > index and unicodedata.category(text[end]) != "Lu":
            cursor = end
            continue
        parts.append(text[index])
        starts.append(index)
        before = text[index]
        if end > index:
            cursor = end
    parts.append(text[cursor:])
    starts.extend(range(cursor, len(text)))
    return _Reading("".join(parts), starts, frozenset(soft))




def _clusters(text: str) -> Iterator[tuple[int, int]]:
    start = 0
    for index in range(1, len(text) + 1):
        if index == len(text) or not _is_mark(text[index]):
            yield start, index
            start = index


def _fold_cluster(cluster: str) -> str:
    return unicodedata.normalize("NFKC", cluster).lower().translate(_FOLD_TABLE)


def fold(text: str) -> str:
    return "".join(_fold_cluster(text[start:end]) for start, end in _clusters(text))


@dataclass(frozen=True)
class _Folded:

    text: str
    starts: list[int]
    ends: list[int]


def _fold_mapped(text: str) -> _Folded:
    parts: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    for start, end in _clusters(text):
        folded = _fold_cluster(text[start:end])
        parts.append(folded)
        starts.extend([start] * len(folded))
        ends.extend([end] * len(folded))
    return _Folded("".join(parts), starts, ends)


def _term_words(term: str) -> tuple[str, ...]:
    return tuple(_split_words(fold(term)))




@dataclass(frozen=True)
class ScreeningRules:

    terms: tuple[str, ...] = ()
    detectors: tuple[str, ...] = ()
    patterns: tuple[tuple[str, ...], ...] = field(default=(), repr=False, compare=False)

    @classmethod
    def build(cls, terms: Iterable[str], detectors: Iterable[str]) -> ScreeningRules | None:
        kept_terms = _normalised_terms(terms)
        wanted = set(detectors)
        kept_detectors = tuple(name for name in DETECTORS if name in wanted)
        if not kept_terms and not kept_detectors:
            return None
        patterns = tuple(_term_words(term) for term in kept_terms)
        return cls(terms=kept_terms, detectors=kept_detectors, patterns=patterns)

    @classmethod
    def from_config(cls, raw: object) -> ScreeningRules | None:
        if raw is None:
            return None
        if not isinstance(raw, Mapping):
            logger.warning("Ignoring screening config of type %s", type(raw).__name__)
            return None
        if not is_screening_config(raw):
            logger.warning("Ignoring screening config: content_terms and detectors must be lists of strings")
            return None
        terms = raw.get("content_terms") or []
        detectors = raw.get("detectors") or []
        unknown = sorted(set(detectors) - set(DETECTORS))
        if unknown:
            logger.warning("Ignoring unknown screening detector(s): %s", unknown)
        return cls.build(terms, detectors)


DETECTORS_ONLY: ScreeningRules = ScreeningRules(detectors=DETECTORS)


def screening_config_unusable(raw: object) -> bool:
    if raw is None or (isinstance(raw, Mapping) and not raw.get("content_terms") and not raw.get("detectors")):
        return False
    return not is_screening_config(raw) or ScreeningRules.from_config(raw) is None


def is_screening_config(raw: object) -> bool:
    if not isinstance(raw, Mapping):
        return False
    terms = raw.get("content_terms") or []
    detectors = raw.get("detectors") or []
    return _is_str_list(terms) and _is_str_list(detectors)


def _is_str_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _normalised_terms(terms: Iterable[str]) -> tuple[str, ...]:
    kept: dict[str, str] = {}
    for term in terms:
        stripped = " ".join(_split_words(term))
        if MIN_TERM_CHARS <= len(stripped) <= MAX_TERM_CHARS:
            kept.setdefault(fold(stripped), stripped)
    return tuple(kept.values())[:MAX_TERMS]



IBAN_LENGTHS: dict[str, int] = {
    "AD": 24, "AE": 23, "AL": 28, "AO": 25, "AT": 20, "AX": 18, "AZ": 28, "BA": 20, "BE": 16, "BF": 28,
    "BG": 22, "BH": 22, "BI": 27, "BJ": 28, "BL": 27, "BR": 29, "BY": 28, "CF": 27, "CG": 27, "CH": 21,
    "CI": 28, "CM": 27, "CR": 22, "CV": 25, "CY": 28, "CZ": 24, "DE": 22, "DJ": 27, "DK": 18, "DO": 28,
    "DZ": 26, "EE": 20, "EG": 29, "ES": 24, "FI": 18, "FK": 18, "FO": 18, "FR": 27, "GA": 27, "GB": 22,
    "GE": 22, "GF": 27, "GG": 22, "GI": 23, "GL": 18, "GP": 27, "GQ": 27, "GR": 27, "GT": 28, "GW": 25,
    "HN": 28, "HR": 21, "HU": 28, "IE": 22, "IL": 23, "IM": 22, "IQ": 23, "IR": 26, "IS": 26, "IT": 27,
    "JE": 22, "JO": 30, "KM": 27, "KW": 30, "KZ": 20, "LB": 28, "LC": 32, "LI": 21, "LT": 20, "LU": 20,
    "LV": 21, "LY": 25, "MA": 28, "MC": 27, "MD": 24, "ME": 22, "MF": 27, "MG": 27, "MK": 19, "ML": 28,
    "MN": 20, "MQ": 27, "MR": 27, "MT": 31, "MU": 30, "MZ": 25, "NC": 27, "NE": 28, "NI": 28, "NL": 18,
    "NO": 15, "OM": 23, "PF": 27, "PK": 24, "PL": 28, "PM": 27, "PS": 29, "PT": 25, "QA": 29, "RE": 27,
    "RO": 24, "RS": 22, "RU": 33, "SA": 24, "SC": 31, "SD": 18, "SE": 24, "SI": 19, "SK": 24, "SM": 27,
    "SN": 28, "SO": 23, "ST": 25, "SV": 28, "TD": 27, "TF": 27, "TG": 28, "TL": 23, "TN": 24, "TR": 26,
    "UA": 29, "VA": 22, "VG": 24, "WF": 27, "XK": 20, "YE": 30, "YT": 27,
}  # fmt: skip

_IBAN_START = re.compile(r"(?<!\d)[A-Za-z](?=[A-Za-z])")
_IBAN_AT = re.compile(r"[A-Za-z](?=[A-Za-z])")
_SVNR_START = re.compile(r"(?<!\d)\d")
_SVNR_AT = re.compile(r"\d")
_SVNR_MARKS = "-./"
_CARD_SPACE = "".join(char for char in _HORIZONTAL_SPACE if char != "\t")
_CARD_RUN = re.compile(rf"\d(?:(?:[{_CARD_SPACE}]+|[-.])?\d)*")
_WRAPPED_CARD_RUN = re.compile(
    rf"\d(?:(?:[{_CARD_SPACE}]+|[-.]|[{_CARD_SPACE}]*(?:\r\n|[{_LINE_BREAKS}])[{_CARD_SPACE}]*)?\d)*"
)
_DIGIT_GROUP = re.compile(r"\d+")


def valid_iban(compact: str) -> bool:
    if IBAN_LENGTHS.get(compact[:2]) != len(compact) or not (compact.isascii() and compact.isalnum()):
        return False
    rearranged = compact[4:] + compact[:4]
    digits = "".join(str(int(char, 36)) for char in rearranged)
    return int(digits) % 97 == 1


def _iban_at(text: str, start: int, soft: frozenset[int]) -> tuple[str, int] | None:
    return _iban_in_groups(text, start, soft, 4) or _iban_in_groups(text, start, soft, 2)


def _iban_in_groups(text: str, start: int, soft: frozenset[int], width: int) -> tuple[str, int] | None:
    country = text[start : start + 2].upper()
    length = IBAN_LENGTHS.get(country)
    if length is None:
        return None
    chars = [country]
    index = start + 2
    for position in range(2, length):
        if position == 2 or position % width == 0:
            index = _skip_separator(text, index, "-.")
        char = _iban_char(text, index, digits_only=position < 4)
        if char is None:
            return None
        chars.append(char)
        index += 1
    compact = "".join(chars)
    if _digit_touches(text, index, soft) or not valid_iban(compact):
        return None
    return compact, index


def _iban_char(text: str, index: int, *, digits_only: bool) -> str | None:
    digit = _digit_at(text, index)
    if digit is not None or digits_only or index >= len(text):
        return digit
    char = text[index]
    return char.upper() if char.isascii() and char.isalpha() else None


def mask_iban(compact: str) -> str:
    hidden = math.ceil(max(len(compact) - 8, 0) / 4)
    return " ".join([compact[:4], *([MASK] * hidden), compact[-4:]])


def _svnr_at(text: str, start: int, soft: frozenset[int]) -> tuple[str, int] | None:
    day_at = _skip_separator(text, start + 4, _SVNR_MARKS)
    month_at = _skip_separator(text, day_at + 2, _SVNR_MARKS)
    split = month_at != day_at + 2
    year_at = _skip_separator(text, month_at + 2, _SVNR_MARKS) if split else month_at + 2
    end = year_at + 2
    parts = [_digits_at(text, start, 4), _digits_at(text, day_at, 2), _digits_at(text, month_at, 2)]
    parts.append(_digits_at(text, year_at, 2))
    if (split and year_at == month_at + 2) or any(part is None for part in parts) or _digit_touches(text, end, soft):
        return None
    digits = "".join(part or "" for part in parts)
    separators = (_separator_kind(text, day_at + 2, month_at), _separator_kind(text, month_at + 2, year_at))
    time_follows = text[end : end + 1] == ":" and _digit_at(text, end + 1) is not None
    unbroken = day_at == start + 4 and not split
    if not valid_at_svnr(digits) or not printed_as_svnr(separators, time_follows):
        return None
    return None if unbroken and not _page_says(text, SVNR_LABELS) else (digits, end)


def _separator_kind(text: str, start: int, end: int) -> str:
    return "" if start == end else (" " if text[start] in WHITESPACE else text[start])


def _page_says(text: str, labels: tuple[str, ...]) -> bool:
    return has_word(fold(text), labels, _is_letter)


def _digit_groups(run: str) -> list[tuple[str, int, int]]:
    return [(_digits_at(run, m.start(), len(m.group())) or "", m.start(), m.end()) for m in _DIGIT_GROUP.finditer(run)]


def _cut_runs(run: str, cuts: list[int]) -> Iterator[list[tuple[str, int, int]]]:
    bounds = [0, *cuts, len(run)]
    for a, b in zip(bounds, bounds[1:], strict=False):
        yield [(digits, start + a, end + a) for digits, start, end in _digit_groups(run[a:b])]




@dataclass(frozen=True)
class Span:

    kind: str
    start: int
    end: int
    term: str | None = None
    sample: str | None = None


def _starts(text: str, soft: frozenset[int], start: re.Pattern[str], at: re.Pattern[str]) -> list[int]:
    found = [match.start() for match in start.finditer(text)]
    extra = [i for i in soft if 0 < i < len(text) and _digit_at(text, i - 1) is not None and at.match(text, i)]
    return sorted({*found, *extra}) if extra else found


def _iban_spans(text: str, soft: frozenset[int]) -> Iterator[Span]:
    resume = 0
    for start in _starts(text, soft, _IBAN_START, _IBAN_AT):
        if start < resume:
            continue
        found = _iban_at(text, start, soft)
        if found is not None:
            compact, resume = found
            yield Span("iban", start, resume, sample=mask_iban(compact))


def _svnr_spans(text: str, soft: frozenset[int]) -> Iterator[Span]:
    resume = 0
    for start in _starts(text, soft, _SVNR_START, _SVNR_AT):
        if start < resume:
            continue
        found = _svnr_at(text, start, soft)
        if found is not None:
            digits, resume = found
            yield Span("at_svnr", start, resume, sample=mask_at_svnr(digits))


def _card_spans(text: str, soft: frozenset[int]) -> Iterator[Span]:
    found = sorted(_unwrapped_cards(text, soft), key=lambda card: card[1])
    found += [card for card in _wrapped_cards(text) if not _overlaps_card(card, found)]
    for digits, start, end in sorted(found, key=lambda card: card[1]):
        yield Span("credit_card", start, end, sample=mask_card(digits))


def _unwrapped_cards(text: str, soft: frozenset[int]) -> Iterator[tuple[str, int, int]]:
    cuts = sorted(soft)
    for match in _CARD_RUN.finditer(text):
        run = match.group(0)
        within = cuts[bisect_right(cuts, match.start()) : bisect_left(cuts, match.end())]
        inside = [cut - match.start() for cut in within]
        found = list(_cards_said(text, match.start(), _digit_groups(run)))
        if inside:
            joined = list(found)
            found += [
                card
                for groups in _cut_runs(run, inside)
                for card in _cards_said(text, match.start(), groups)
                if not _overlaps_card(card, joined)
            ]
        for digits, start, end in found:
            yield digits, match.start() + start, match.start() + end


def _cards_said(text: str, offset: int, groups: list[tuple[str, int, int]]) -> Iterator[tuple[str, int, int]]:
    for digits, start, end, unbroken in cards_in(groups):
        if not unbroken or _has_card_context(text, offset + start, offset + end):
            yield digits, start, end


def _has_card_context(text: str, start: int, end: int) -> bool:
    begin, stop = context_window(text, start, end, _is_letter)
    near = fold(text[begin:stop])
    return has_word(near, CARD_CONTEXT_WORDS, _is_letter) or _page_says(text, CARD_PAGE_LABELS)


def _wrapped_cards(text: str) -> Iterator[tuple[str, int, int]]:
    for match in _WRAPPED_CARD_RUN.finditer(text):
        run = match.group(0)
        if not any(char in _LINE_BREAKS for char in run):
            continue
        for digits, start, end, _ in cards_in(_digit_groups(run), wrapped_card_layout):
            if any(char in _LINE_BREAKS for char in run[start:end]):
                yield digits, match.start() + start, match.start() + end


def _overlaps_card(card: tuple[str, int, int], others: list[tuple[str, int, int]]) -> bool:
    return any(card[1] < end and start < card[2] for _, start, end in others)


def _de_svnr_spans(text: str, soft: frozenset[int]) -> Iterator[Span]:
    resume = 0
    for start in _starts(text, soft, _SVNR_START, _SVNR_AT):
        if start < resume:
            continue
        found = de_svnr_at(text, start, soft)
        if found is not None:
            compact, resume = found
            yield Span("de_svnr", start, resume, sample=mask_de_svnr(compact))


def _de_tax_id_spans(text: str, soft: frozenset[int]) -> Iterator[Span]:
    if not _page_says(text, TAX_ID_LABELS):
        return
    resume = 0
    for start in _starts(text, soft, _SVNR_START, _SVNR_AT):
        if start < resume:
            continue
        found = de_tax_id_at(text, start, soft)
        if found is not None:
            digits, resume = found
            yield Span("de_tax_id", start, resume, sample=mask_de_tax_id(digits))


_DETECTOR_SPANS = {
    "iban": _iban_spans,
    "at_svnr": _svnr_spans,
    "credit_card": _card_spans,
    "de_svnr": _de_svnr_spans,
    "de_tax_id": _de_tax_id_spans,
}


_SPLIT_TERM_MIN = 8
_TERM_FRAGMENT = 3
_TERM_JOINERS = " -\u2010\u2011"


def _word_end(text: str, end: int) -> int:
    while end < len(text) and unicodedata.category(text[end])[0] in "LNM":
        end += 1
    return end


def _starts_a_word(folded: _Folded, text: str, index: int) -> bool:
    if index == 0:
        return True
    previous = folded.starts[index - 1]
    return previous != folded.starts[index] and not _is_letter(text[previous])


def _words_end(folded: str, start: int, words: tuple[str, ...]) -> int:
    cursor = start
    for position, word in enumerate(words):
        gap = cursor
        while position and cursor < len(folded) and folded[cursor] in WHITESPACE:
            cursor += 1
        if (position and cursor == gap) or not folded.startswith(word, cursor):
            return -1
        cursor += len(word)
    return cursor


def _word_end_split(folded: str, start: int, word: str) -> int:
    cursor = start
    split = False
    for position, char in enumerate(word):
        if cursor < len(folded) and folded[cursor] == char:
            cursor += 1
            continue
        joined = cursor + 1 < len(folded) and folded[cursor] in _TERM_JOINERS and folded[cursor + 1] == char
        if split or not joined or not _TERM_FRAGMENT <= position <= len(word) - _TERM_FRAGMENT:
            return -1
        split = True
        cursor += 2
    return cursor


def _long_term_matches(folded: _Folded, text: str, word: str) -> Iterator[tuple[int, int]]:
    anchor = word[:_TERM_FRAGMENT]
    index = folded.text.find(anchor)
    while index != -1:
        end = _word_end_split(folded.text, index, word) if _starts_a_word(folded, text, index) else -1
        if end > index:
            yield index, end
            index = folded.text.find(anchor, end)
        else:
            index = folded.text.find(anchor, index + 1)


def _term_matches(folded: _Folded, text: str, words: tuple[str, ...]) -> Iterator[tuple[int, int]]:
    if not words:
        return
    if len(words) == 1 and len(words[0]) >= _SPLIT_TERM_MIN:
        yield from _long_term_matches(folded, text, words[0])
        return
    index = folded.text.find(words[0])
    while index != -1:
        end = _words_end(folded.text, index, words) if _starts_a_word(folded, text, index) else -1
        if end > index:
            yield index, end
            index = folded.text.find(words[0], end)
        else:
            index = folded.text.find(words[0], index + 1)


def _term_spans(text: str, rules: ScreeningRules) -> Iterator[Span]:
    folded = _fold_mapped(text)
    for term, words in zip(rules.terms, rules.patterns, strict=True):
        for match_start, match_end in _term_matches(folded, text, words):
            start = folded.starts[match_start]
            end = _word_end(text, folded.ends[match_end - 1])
            yield Span("term", start, end, term=term)


def find_spans(text: str, rules: ScreeningRules) -> list[Span]:
    if not text:
        return []
    protected = [(match.start(), match.end()) for match in _PLACEHOLDER_RE.finditer(text)]
    reading = _read(text)
    spans = list(_term_spans(reading.text, rules))
    for name in rules.detectors:
        spans.extend(_DETECTOR_SPANS[name](reading.text, reading.soft))
    original = [_in_original(span, reading) for span in _outside_ibans(spans)]
    return [span for span in original if not _overlaps_any(span, protected)]


def _in_original(span: Span, reading: _Reading) -> Span:
    start, end = reading.original(span.start, span.end)
    return replace(span, start=start, end=end)


def _outside_ibans(spans: list[Span]) -> list[Span]:
    ibans = sorted((span for span in spans if span.kind == "iban"), key=lambda span: span.start)
    starts = [iban.start for iban in ibans]

    def inside(span: Span) -> bool:
        at = bisect_right(starts, span.start) - 1
        return at >= 0 and span.end <= ibans[at].end

    return [span for span in spans if span.kind not in _NUMBER_KINDS or not inside(span)]


_NUMBER_KINDS = ("at_svnr", "credit_card", "de_svnr", "de_tax_id")


def _overlaps_any(span: Span, regions: list[tuple[int, int]]) -> bool:
    return any(span.start < end and start < span.end for start, end in regions)




@dataclass(frozen=True)
class Finding:

    kind: str
    count: int
    term: str | None = None
    sample: str | None = None

    def as_json(self) -> dict[str, object]:
        out: dict[str, object] = {"kind": self.kind}
        if self.term is not None:
            out["term"] = self.term
        out["count"] = self.count
        if self.sample is not None:
            out["sample"] = self.sample
        return out


@dataclass(frozen=True)
class MaskedText:

    text: str
    findings: tuple[Finding, ...] = ()

    @property
    def masked(self) -> bool:
        return bool(self.findings)


def _merged(spans: list[Span]) -> list[Span]:
    out: list[Span] = []
    for span in sorted(spans, key=lambda s: (s.start, -s.end)):
        if out and span.start < out[-1].end:
            last = out[-1]
            out[-1] = Span(last.kind, last.start, max(last.end, span.end), last.term, last.sample)
        else:
            out.append(span)
    return out


def _replaced(text: str, spans: list[Span]) -> str:
    parts: list[str] = []
    cursor = 0
    for span in _merged(spans):
        parts.append(text[cursor : span.start])
        parts.append(PLACEHOLDERS[span.kind])
        cursor = span.end
    parts.append(text[cursor:])
    return "".join(parts)


def _findings(spans: list[Span], rules: ScreeningRules) -> tuple[Finding, ...]:
    by_rule: dict[tuple[str, str | None], list[Span]] = {}
    for span in spans:
        by_rule.setdefault((span.kind, span.term), []).append(span)
    order = [("term", term) for term in rules.terms] + [(name, None) for name in rules.detectors]
    findings: list[Finding] = []
    for kind, term in order:
        matched = by_rule.get((kind, term))
        if matched:
            findings.append(Finding(kind=kind, count=len(matched), term=term, sample=matched[0].sample))
    return tuple(findings)


def mask_text(text: str, rules: ScreeningRules | None) -> MaskedText:
    if rules is None or not text:
        return MaskedText(text)
    found: list[Span] = []
    current = text
    spans = find_spans(current, rules)
    while spans:
        found.extend(spans)
        current = _replaced(current, spans)
        spans = find_spans(current, rules)
    return MaskedText(current, _findings(found, rules))


def findings_summary(findings: Iterable[Finding]) -> str:
    return ", ".join(f"{finding.kind}={finding.count}" for finding in findings)
