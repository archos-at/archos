from __future__ import annotations

import unicodedata
from collections.abc import Iterator
from typing import TYPE_CHECKING

from agent.common.screen_chars import WHITESPACE
from agent.common.screen_chars import _is_letter
from agent.common.screen_reading import _fold_mapped
from agent.common.screen_reading import _Folded
from agent.common.screen_spans import Span

if TYPE_CHECKING:
    from agent.common.content_screen import ScreeningRules


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
