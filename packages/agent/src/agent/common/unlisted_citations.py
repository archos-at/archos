from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.extraction import _entry_from_hit
from agent.citations.report_layout import inline_citation_numbers
from agent.common.grounding_block import get_grounding_block

_RESULT_HEADER_RE = re.compile(r"^--- Result (\d+) ---$", re.MULTILINE)


def turn_passages(results: Sequence[tuple[str, Any, Any]]) -> dict[int, list[SourceEntry]]:
    from agent.common.citation_collector import hits_from_artifact

    numbered: dict[int, list[SourceEntry]] = {}
    for tool_name, content, artifact in results:
        hits = hits_from_artifact(artifact)
        text = content if isinstance(content, str) else ""
        if hits is None:
            block = get_grounding_block(text) if text else None
            hits = block.hits if block is not None else None
        if not hits:
            continue
        printed = [int(number) for number in _RESULT_HEADER_RE.findall(text)]
        numbers = printed if len(printed) == len(hits) else list(range(1, len(hits) + 1))
        for number, hit in zip(numbers, hits, strict=True):
            entry = _entry_from_hit(hit, tool_name)
            held = numbered.setdefault(number, [])
            if all(other.citation_key != entry.citation_key or other.chunk_text != entry.chunk_text for other in held):
                held.append(entry)
    return numbered


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_HOLD_WORD_RE = re.compile(r"[^\W\d_][^\W_]{3,}")
_HOLD_NUMBER_RE = re.compile(r"(?<![\w-])\d+(?:[.,]\d+)?(?!\w)")


def _holds(sentence: str, entry: SourceEntry) -> bool:
    text = (entry.chunk_text or "").casefold()
    if not text.strip():
        return False
    named = entry.citation_key.split(", ")[0].casefold()
    plain = re.sub(r"\[\d+\]", " ", sentence.casefold()).replace(named, " ")
    if not set(_HOLD_NUMBER_RE.findall(plain)) <= set(_HOLD_NUMBER_RE.findall(text)):
        return False
    words = set(_HOLD_WORD_RE.findall(plain))
    held = set(_HOLD_WORD_RE.findall(text))
    return bool(words) and len(words & held) * 2 >= len(words)


def _carrying(text: str, number: int) -> list[str]:
    return [part for part in _SENTENCE_RE.split(text) if f"[{number}]" in part]


def resolve_unlisted_numbers(text: str, numbered: dict[int, list[SourceEntry]]) -> list[SourceEntry | None]:
    every = [entry for held in numbered.values() for entry in held]
    resolved: dict[int, SourceEntry] = {}
    for number in sorted(inline_citation_numbers(text)):
        carrying = _carrying(text, number)
        counts = [(sum(_holds(sentence, entry) for sentence in carrying), entry) for entry in every]
        best = max((count for count, _ in counts), default=0)
        if best == 0:
            continue
        tied = [entry for count, entry in counts if count == best]
        printed = [entry for entry in tied if entry in numbered.get(number, [])]
        resolved[number] = (printed or tied)[0]
    if not resolved:
        return []
    return [resolved.get(position) for position in range(1, max(resolved) + 1)]


def writer_numbering(text: str, turn: Sequence[Any]) -> list[SourceEntry | None]:
    from langchain_core.messages import ToolMessage

    results = [(m.name or "", m.content, getattr(m, "artifact", None)) for m in turn if isinstance(m, ToolMessage)]
    return resolve_unlisted_numbers(text, turn_passages(results))
