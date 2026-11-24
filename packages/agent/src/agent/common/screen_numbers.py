from __future__ import annotations

import math
import re
from bisect import bisect_left
from bisect import bisect_right
from collections.abc import Iterator

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
from agent.common.screen_chars import _skip_separator
from agent.common.screen_reading import fold
from agent.common.screen_spans import Span
from agent.common.svnr_numbers import SVNR_LABELS
from agent.common.svnr_numbers import mask_at_svnr
from agent.common.svnr_numbers import printed_as_svnr
from agent.common.svnr_numbers import valid_at_svnr

MASK = "••••"

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
        yield from _cards_across_lines(match)


def _cards_across_lines(match: re.Match[str]) -> Iterator[tuple[str, int, int]]:
    run = match.group(0)
    if not any(char in _LINE_BREAKS for char in run):
        return
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
