from __future__ import annotations

import unicodedata

WHITESPACE = (
    "\t\n\x0b\x0c\r \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_LINE_BREAKS = "\n\x0b\x0c\r\x85\u2028\u2029"
_HORIZONTAL_SPACE = "".join(char for char in WHITESPACE if char not in _LINE_BREAKS)


def _is_mark(char: str) -> bool:
    return unicodedata.category(char)[0] == "M"


def _is_letter(char: str) -> bool:
    return unicodedata.category(char)[0] == "L"


def _is_word_char(char: str) -> bool:
    return unicodedata.category(char)[0] in "LN"


def _digit_at(text: str, index: int) -> str | None:
    if index >= len(text):
        return None
    value = unicodedata.decimal(text[index], None)
    return None if value is None else str(value)


def _skip_separator(text: str, index: int, marks: str) -> int:
    if index < len(text) and text[index] in WHITESPACE:
        while index < len(text) and text[index] in WHITESPACE:
            index += 1
    elif index < len(text) and text[index] in marks:
        index += 1
    return index


def _digit_touches(text: str, index: int, soft: frozenset[int]) -> bool:
    return _digit_at(text, index) is not None and index not in soft


def _digits_at(text: str, index: int, count: int) -> str | None:
    digits = ""
    for offset in range(count):
        digit = _digit_at(text, index + offset)
        if digit is None:
            return None
        digits += digit
    return digits
