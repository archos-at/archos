from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from typing import Any

import regex

from .matches import MAX_MATCH_CHUNKS

MIN_PHRASE_CHARS = 2

MAX_USER_PATTERN_CHARS = 300

MAX_ALTERNATIVES = 6

_SEPARATOR_CHARS = "\u00ad\u2010\u2011\u2013-"

_SEPARATOR = f"[\\s{_SEPARATOR_CHARS}]+"

_EQUIVALENT = {
    "ä": "(?:ä|a\u0308|ae)",
    "ö": "(?:ö|o\u0308|oe)",
    "ü": "(?:ü|u\u0308|ue)",
    "ß": "(?:ß|ss)",
}

_TOKEN = re.compile(f"[\\s{_SEPARATOR_CHARS}]+|ae|oe|ue|ss|.", re.DOTALL)

WHOLE_WORD_MAX_CHARS = 3

MAX_PATTERN_CHARS = 4000


def _phrase_pattern(phrase: str) -> str:
    text = unicodedata.normalize("NFC", phrase).lower()
    body = "".join(
        _SEPARATOR if token[0].isspace() or token[0] in _SEPARATOR_CHARS else _EQUIVALENT.get(token, re.escape(token))
        for token in _TOKEN.findall(text)
    )
    if len(text) > WHOLE_WORD_MAX_CHARS:
        return body
    start = "\\b" if re.match(r"\w", text[0]) else ""
    end = "\\b" if re.match(r"\w", text[-1]) else ""
    return f"{start}{body}{end}"


_INFLECTION_ENDINGS = ("ern", "nen", "en", "er", "es", "em", "e", "n", "s")

_INFLECTED_MIN_CHARS = 5

_STEM_MIN_CHARS = 4


def inflection_stem(phrase: str) -> str:
    words = []
    for word in phrase.split():
        stem = word
        if len(word) >= _INFLECTED_MIN_CHARS and word.isalpha():
            for ending in _INFLECTION_ENDINGS:
                if word.lower().endswith(ending) and len(word) - len(ending) >= _STEM_MIN_CHARS:
                    stem = word[: -len(ending)]
                    break
        words.append(stem)
    return " ".join(words)


def stemmed_pattern(phrases: Sequence[str]) -> str | None:
    stems = [inflection_stem(phrase) for phrase in phrases]
    return phrase_pattern([*phrases, *stems]) or phrase_pattern(phrases)


def phrase_pattern(phrases: Sequence[str]) -> str | None:
    ordered = sorted(dict.fromkeys(phrases), key=len, reverse=True)
    pattern = "(?i)" + "|".join(_phrase_pattern(phrase) for phrase in ordered)
    return pattern if len(pattern) <= MAX_PATTERN_CHARS and ordered else None


def split_alternatives(text: str) -> list[str]:
    parts = [" ".join(part.split()) for part in unicodedata.normalize("NFC", text or "").split("|")]
    kept = [part for part in dict.fromkeys(parts) if len(part) >= MIN_PHRASE_CHARS and re.search(r"\w", part)]
    return kept[:MAX_ALTERNATIVES]


def user_pattern(text: str) -> tuple[Any | None, str]:
    from knowledge_layer.vector_store import compile_user_regex

    pattern = text.strip()
    if len(pattern) < MIN_PHRASE_CHARS:
        return None, f"Provide a `query` of at least {MIN_PHRASE_CHARS} characters: the regex to find."
    if len(pattern) > MAX_USER_PATTERN_CHARS:
        return None, (
            f"`query` is too long for a regex ({len(pattern)} characters, at most {MAX_USER_PATTERN_CHARS}). "
            "Shorten it to the part that identifies the passage."
        )
    try:
        compiled = compile_user_regex(pattern)
    except (regex.error, RecursionError, OverflowError) as error:
        return None, (
            f"`query` is not a valid regex (Python syntax): {error}. Escape a literal ( ) [ ] {{ }} . * + ? | \\ "
            "with a backslash, or search literally for a literal word."
        )
    if compiled.search(""):
        return None, (
            "`query` matches the empty string, so it would match every passage. Add the text that must be there."
        )
    return compiled, ""


_NEEDS_A_ANCHOR = (
    "A regex needs something to narrow the search with: one literal whole word or number it must contain, or a "
    "`folder=`, `file_name=` or `doc_class=` to read in. This pattern has no such word: a word followed by `?`, "
    "`*`, `\\w` or a class does not count, and neither does a character class or a digit run alone. Rewrite it "
    "so one word is written out in full (`MA ?37/\\d{6}` becomes `MA 37/\\d{6}`; `T\\d+` becomes `\\bT30-\\d+`), "
    'keep that word and give `folder=`, or use `match="exact"` for a literal.'
)

_TOO_COSTLY = (
    "`query` is too costly: the regex backtracks on a passage of the files (nested repetition such as `(a+)+`, or "
    "overlapping alternatives under a `*`), and the search was stopped. This is NOT a result, neither a hit nor "
    'a no. Rewrite it without nested repetition, or use `match="exact"` for a literal word.'
)

_TOO_COSTLY_SCAN = (
    "`query` is too costly: reading this regex over every passage that holds its words takes longer than one "
    "search may, and the search was stopped. This is NOT a result, neither a hit nor a no. Narrow it with "
    '`folder=`, `file_name=` or `doc_class=`, add a rarer literal word, or use `match="exact"` for a literal word.'
)

_CAPPED_WITHOUT_OWN_MATCH = (
    f"The search stopped after {MAX_MATCH_CHUNKS} matching passages, and in those the words stood only in "
    "headings restated from elsewhere or in text repeated from the passage before. What lies past that limit was "
    "not read: this is NOT a no. Narrow it with `folder=`, `file_name=` or `doc_class=`."
)
