from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass

from agent.common.screen_chars import _HORIZONTAL_SPACE
from agent.common.screen_chars import _LINE_BREAKS
from agent.common.screen_chars import WHITESPACE
from agent.common.screen_chars import _is_mark
from agent.common.screen_chars import _is_word_char

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
