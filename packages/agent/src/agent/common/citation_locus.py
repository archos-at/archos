from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

_CLAUSE_END_RE = re.compile(r"(?<!\d)\.(?=\s+[A-ZÄÖÜ„\"])|[;!?\n]|\[\d+\]")

_LOOKBACK_CHARS = 80

_CLAUSE_NUMBER_RE = re.compile(r"\b(?:Punkt|Pkt\.?|Pt\.)\s*(\d+(?:\.\d+)+)\b", re.IGNORECASE)
_PARAGRAPH_RE = re.compile(r"§§?\s*(\d+[a-z]?)\b", re.IGNORECASE)
_INLINE_MARKER_RE = re.compile(r"\[(\d+)\]")


class LocusEntry(Protocol):

    chunk_text: str | None
    clause: str | None
    title: str | None
    citation_key: str | None
    url: str | None


@dataclass(frozen=True)
class Locus:

    kind: str  # "clause" or "paragraph"
    value: str

    def __str__(self) -> str:
        return f"Punkt {self.value}" if self.kind == "clause" else f"§ {self.value}"


@dataclass(frozen=True)
class LocusMismatch:

    number: int
    locus: Locus
    start: int
    end: int


def locus_before(text: str, marker_start: int) -> Locus | None:
    window_start = max(0, marker_start - _LOOKBACK_CHARS)
    window = text[window_start:marker_start]
    ends = list(_CLAUSE_END_RE.finditer(window))
    if ends:
        window = window[ends[-1].end() :]
    found: list[tuple[int, Locus]] = []
    found += [(match.start(), Locus("clause", match.group(1))) for match in _CLAUSE_NUMBER_RE.finditer(window)]
    found += [(match.start(), Locus("paragraph", match.group(1).lower())) for match in _PARAGRAPH_RE.finditer(window)]
    if not found:
        return None
    return max(found, key=lambda item: item[0])[1]


def _clause_agrees(clause: str, value: str) -> bool:
    clause = clause.strip().rstrip(".")
    if not clause:
        return False
    return clause == value or value.startswith(clause + ".") or clause.startswith(value + ".")


def locus_in_entry(locus: Locus, entry: LocusEntry) -> bool | None:
    text = " ".join(part for part in (entry.chunk_text, entry.title, entry.citation_key) if part)
    if not (entry.chunk_text or entry.clause):
        return None
    if locus.kind == "clause":
        if entry.clause and _clause_agrees(entry.clause, locus.value):
            return True
        return re.search(rf"(?<![\d.]){re.escape(locus.value)}(?![\d]|\.\d)", text) is not None
    if re.search(rf"§§?\s*{re.escape(locus.value)}(?![\d])", text, re.IGNORECASE):
        return True
    url = entry.url or ""
    return re.search(rf"[?&]Paragraf={re.escape(locus.value)}(?![\d])", url, re.IGNORECASE) is not None


def locus_mismatches(body: str, entries: Mapping[int, LocusEntry]) -> list[LocusMismatch]:
    mismatches: list[LocusMismatch] = []
    for match in _INLINE_MARKER_RE.finditer(body):
        number = int(match.group(1))
        entry = entries.get(number)
        if entry is None:
            continue
        locus = locus_before(body, match.start())
        if locus is None or locus_in_entry(locus, entry) is not False:
            continue
        mismatches.append(LocusMismatch(number, locus, match.start(), match.end()))
    return mismatches
