from __future__ import annotations

import re
from collections import Counter

_POLARITY_WORDS = frozenset(
    {
        "nicht",
        "nichts",
        "kein",
        "keine",
        "keinen",
        "keinem",
        "keiner",
        "keines",
        "nie",
        "niemals",
        "weder",
        "ohne",
        "nur",
        "außer",
        "ausser",
        "not",
        "no",
        "never",
        "without",
        "only",
        "except",
    }
)

_UN_WORDS = ("und", "uns", "unser", "unter", "ungefähr", "ungefaehr")

_WORD_RE = re.compile(r"[^\W\d_]+")

_MIN_PREFIXED_LENGTH = 6


def polarity_tokens(text: str) -> Counter[str]:
    tokens: Counter[str] = Counter()
    for word in _WORD_RE.findall(text.casefold()):
        if word in _POLARITY_WORDS:
            tokens[word] += 1
        elif word.startswith("un") and len(word) >= _MIN_PREFIXED_LENGTH and not word.startswith(_UN_WORDS):
            tokens["un-"] += 1
    return tokens


def polarity_agrees(quote: str, passage_stretch: str) -> bool:
    return polarity_tokens(quote) == polarity_tokens(passage_stretch)
