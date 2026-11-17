from __future__ import annotations

import re
from collections.abc import Sequence

#: Measured on the 776-page base corpus: ``OIB`` 95%, ``punkt`` 27.8% (noise) against ``Geschoß`` 23.2% (core noun); 0.2 silenced ``Geschoss``.
DEFAULT_DF_CEILING_RATIO = 0.25

DEFAULT_DF_CEILING_MIN_TOTAL = 25

_TOKEN_RE = re.compile(r"\d+(?:\.\d+)+|[^\W_]+", re.UNICODE)

_FOLD = (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss"))

_VOWELS = frozenset("aeiouy")

_S_ENDINGS = frozenset("bdfghklmnrt")

_SUFFIXES = ("ern", "em", "er", "en", "es", "e")

#: 2 let ``of`` match German chunks through the 0.6% of pages with English ÖNORM titles.
_MIN_TERM_LENGTH = 3


def fold(text: str | None) -> str:
    if not text:
        return ""
    folded = text.strip().lower()
    for source, target in _FOLD:
        folded = folded.replace(source, target)
    return folded


def tokenize(text: str | None) -> list[str]:
    if not text:
        return []
    return _TOKEN_RE.findall(text.lower())


def _r1(word: str) -> int:
    for index in range(1, len(word)):
        if word[index] not in _VOWELS and word[index - 1] in _VOWELS:
            return max(index + 1, 3)
    return len(word)


def stem(token: str) -> str:
    if not token or token[0].isdigit():
        return token
    region = _r1(token)
    for suffix in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= region:
            return token[: -len(suffix)]
    if token.endswith("s") and len(token) - 1 >= region and token[-2] in _S_ENDINGS:
        return token[:-1]
    return token


def _is_useful(lexeme: str) -> bool:
    if not lexeme:
        return False
    return len(lexeme) >= _MIN_TERM_LENGTH or lexeme.isdigit()


def analyze(text: str | None) -> list[str]:
    lexemes: list[str] = []
    for token in tokenize(fold(text)):
        lexeme = stem(token)
        if _is_useful(lexeme) and lexeme not in lexemes:
            lexemes.append(lexeme)
    return lexemes


def analyze_query(text: str | None, *, extra_terms: Sequence[str] = ()) -> list[str]:
    return _merge_terms(analyze, text, extra_terms)


def index_blob(text: str | None) -> str:
    lexemes = analyze(text)
    return f" {' '.join(lexemes)} " if lexemes else ""


def like_pattern(lexeme: str) -> str:
    return f"% {lexeme} %"


def _plain_terms(text: str | None) -> list[str]:
    terms: list[str] = []
    for token in tokenize(text):
        if len(token) < _MIN_TERM_LENGTH and not token.isdigit():
            continue
        if token not in terms:
            terms.append(token)
    return terms


def _merge_terms(analyzer, text: str | None, extra_terms: Sequence[str]) -> list[str]:
    merged: list[str] = []
    for source in (*(extra_terms or ()), text):
        for term in analyzer(source):
            if term not in merged:
                merged.append(term)
    return merged


def query_terms(text: str | None, *, extra_terms: Sequence[str] = ()) -> list[str]:
    return _merge_terms(_plain_terms, text, extra_terms)


_DIGRAPHS = (("ä", "ae"), ("ö", "oe"), ("ü", "ue"))


def umlaut_spellings(term: str) -> list[str]:
    spellings = [term]
    digraphed = term
    umlauted = term
    for umlaut, digraph in _DIGRAPHS:
        digraphed = digraphed.replace(umlaut, digraph)
        umlauted = umlauted.replace(digraph, umlaut)
    for spelling in (digraphed, umlauted):
        if spelling not in spellings:
            spellings.append(spelling)
    return spellings


def select_terms(
    terms: list[str],
    frequencies: dict[str, int],
    total: int,
    *,
    df_ceiling_ratio: float = DEFAULT_DF_CEILING_RATIO,
    min_total: int = DEFAULT_DF_CEILING_MIN_TOTAL,
) -> list[str]:
    if not terms or total <= 0:
        return []
    apply_ceiling = total >= min_total
    ceiling = total * df_ceiling_ratio
    kept: list[str] = []
    for term in terms:
        frequency = frequencies.get(term, 0)
        if frequency <= 0:
            continue
        if apply_ceiling and frequency > ceiling:
            continue
        kept.append(term)
    if not any(any(character.isalpha() for character in term) for term in kept):
        return []
    return kept


def build_tsquery(terms: list[str]) -> str:
    return " | ".join("'" + term.replace("'", "''") + "'" for term in terms if term)
