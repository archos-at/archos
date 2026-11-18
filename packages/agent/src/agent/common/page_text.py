from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from collections.abc import Sequence

FURNITURE_PAGE_SHARE = 0.5
FURNITURE_MIN_PAGES = 3

_DIGITS = re.compile(r"\d+")


def furniture_key(line: str) -> str:
    return _DIGITS.sub("#", line.strip().lower())


def running_furniture(pages: Sequence[Sequence[str]]) -> set[str]:
    if len(pages) < FURNITURE_MIN_PAGES:
        return set()
    counts: Counter[str] = Counter()
    for lines in pages:
        counts.update({furniture_key(line) for line in [*lines[:2], *lines[-2:]]})
    threshold = max(FURNITURE_MIN_PAGES, FURNITURE_PAGE_SHARE * len(pages))
    return {key for key, count in counts.items() if count >= threshold and key}


def without_furniture(lines: Iterable[str], furniture: set[str]) -> list[str]:
    return [line for line in lines if furniture_key(line) not in furniture]
