"""The characters the content screen reads numbers by: whitespace, Unicode digits, separators.

A leaf both :mod:`agent.common.content_screen` and the per-country number rules
(:mod:`agent.common.de_numbers`) read, so a country's parser and the scanner
agree on what a digit and a separator are. The names keep their leading
underscore: they are the screen's internals, shared by its own modules only.
The TypeScript twin keeps them in ``apps/workspace/bff/upload-screening/content-screen.ts``.
"""

from __future__ import annotations

import unicodedata

#: Unicode's ``White_Space`` property, all 25 code points. The one definition of
#: whitespace on both sides (the TypeScript twin lists the same, and its spec
#: holds the list to ``\p{White_Space}``).
WHITESPACE = (
    "\t\n\x0b\x0c\r \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_LINE_BREAKS = "\n\x0b\x0c\r\x85\u2028\u2029"
#: Whitespace that keeps a line: what may join the groups of a card number.
_HORIZONTAL_SPACE = "".join(char for char in WHITESPACE if char not in _LINE_BREAKS)


def _is_mark(char: str) -> bool:
    return unicodedata.category(char)[0] == "M"


def _is_letter(char: str) -> bool:
    """A letter: general category ``L*``."""
    return unicodedata.category(char)[0] == "L"


def _is_word_char(char: str) -> bool:
    """A letter or a number: general category ``L*`` or ``N*``."""
    return unicodedata.category(char)[0] in "LN"


def _digit_at(text: str, index: int) -> str | None:
    """The ASCII digit for a Unicode decimal digit (``Nd``) at ``index``, else ``None``."""
    if index >= len(text):
        return None
    value = unicodedata.decimal(text[index], None)
    return None if value is None else str(value)


def _skip_separator(text: str, index: int, marks: str) -> int:
    """``index`` moved past one separator: a run of whitespace, or one of ``marks``."""
    if index < len(text) and text[index] in WHITESPACE:
        while index < len(text) and text[index] in WHITESPACE:
            index += 1
    elif index < len(text) and text[index] in marks:
        index += 1
    return index


def _digit_touches(text: str, index: int, soft: frozenset[int]) -> bool:
    """Whether a digit stands at ``index`` right against what came before, without even an invisible character."""
    return _digit_at(text, index) is not None and index not in soft


def _digits_at(text: str, index: int, count: int) -> str | None:
    """``count`` digits from ``index`` on, as ASCII; ``None`` unless every one is a digit."""
    digits = ""
    for offset in range(count):
        digit = _digit_at(text, index + offset)
        if digit is None:
            return None
        digits += digit
    return digits
