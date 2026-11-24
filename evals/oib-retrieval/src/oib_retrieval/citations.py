from __future__ import annotations

import re

_CITATION_RE = re.compile(
    r"(?P<file>[A-Za-z0-9][\w.\-]*\.(?:pdf|PDF))(?:\s*\([^)]*\))?\s*,\s*p\.\s*(?P<page>\d+)",
)


def extract_units(text: str | None) -> list[tuple[str, int]]:
    if not text:
        return []
    units: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for match in _CITATION_RE.finditer(text):
        unit = (match.group("file"), int(match.group("page")))
        if unit in seen:
            continue
        seen.add(unit)
        units.append(unit)
    return units
