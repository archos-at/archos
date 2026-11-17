from __future__ import annotations

import re
from collections.abc import Iterator
from collections.abc import Sequence
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.quote_matching import MIN_QUOTE_LEN
from agent.citations.quote_matching import QUOTE_MATCH_THRESHOLD
from agent.citations.quote_matching import quote_coverage
from agent.citations.wire import source_entry_to_wire

_LOCATION_KEYS = ("title", "file_name", "page", "clause", "url")

Cited = tuple[SourceEntry, int | None]

_QUOTE_LINE = re.compile(
    r"^[ \t]*(?:>[ \t]?)+[ \t]*"
    r"(?:„(?P<low>[^„“”\"]+)[“”\"]|»(?P<guillemet>[^»«]+)«|“(?P<curly>[^“”]+)”|\"(?P<straight>[^\"]+)\")"
    r"(?P<rest>.*)$"
)
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_NUMBER = re.compile(r"\[(\d+)\]")
_MARK = re.compile(r"==")


def quote_lines(text: str) -> Iterator[tuple[str, tuple[int, ...]]]:
    fence: str | None = None
    for line in text.split("\n"):
        fence_match = _FENCE.match(line)
        if fence is not None:
            if fence_match and fence_match.group(1)[0] == fence[0] and len(fence_match.group(1)) >= len(fence):
                fence = None
            continue
        if fence_match:
            fence = fence_match.group(1)
            continue
        match = _QUOTE_LINE.match(line)
        if match is None:
            continue
        wording = next(group for group in match.group("low", "guillemet", "curly", "straight") if group is not None)
        yield wording.strip(), tuple(int(number) for number in _NUMBER.findall(match.group("rest")))


def stamp_quote_lines(text: str, cited: Sequence[Cited], read: Sequence[SourceEntry]) -> list[dict[str, Any]]:
    return [
        {"text": wording, **verification_for(wording, _own_first(cited, numbers), read)}
        for wording, numbers in quote_lines(text)
    ]


def verification_for(quote: Any, cited: Sequence[Cited], read: Sequence[SourceEntry]) -> dict[str, Any]:
    text = _MARK.sub("", quote).strip() if isinstance(quote, str) else ""
    candidates = _candidates(cited, read)
    if len(text) < MIN_QUOTE_LEN or not candidates:
        return {"status": "unchecked"}
    for entry, number in candidates:
        if quote_coverage(text, entry.chunk_text or "") >= QUOTE_MATCH_THRESHOLD:
            return _located(entry, number)
    return {"status": "not_found"}


def _own_first(cited: Sequence[Cited], numbers: tuple[int, ...]) -> list[Cited]:
    own = [pair[1] is not None and pair[1] in numbers for pair in cited]
    return [pair for pair, mine in zip(cited, own, strict=True) if mine] + [
        pair for pair, mine in zip(cited, own, strict=True) if not mine
    ]


def _candidates(cited: Sequence[Cited], read: Sequence[SourceEntry]) -> list[Cited]:
    seen = {id(entry) for entry, _ in cited}
    ordered = [*cited, *((entry, None) for entry in read if id(entry) not in seen)]
    return [(entry, number) for entry, number in ordered if entry.chunk_text]


def _located(entry: SourceEntry, number: int | None) -> dict[str, Any]:
    wire = source_entry_to_wire(entry, number=number)
    location = {key: wire[key] for key in _LOCATION_KEYS if key in wire}
    return {"status": "verbatim", **({"number": number} if number is not None else {}), **location}
