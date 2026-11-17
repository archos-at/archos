from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .fetch import _fetch_all
from .models import PassageTarget
from .ranges import _clause_spellings

_MAX_OUTLINE_CHUNKS = 160

_MAX_OUTLINE_LINES = 80

_OUTLINE_DEPTHS = (1, 2)

_OUTLINE_INSTRUCTION = (
    "Open a listed Punkt by its number. The Gliederung is an index, not evidence: only the passages above "
    "carry a Citation."
)

_NO_CLAUSES_LINE = (
    "This document is not structured in Punkte, so it has no Gliederung: its first passages are above, and "
    "further pages open by their number."
)

_EXCERPT_CHARS = 120


def _outline_filters(file_name: str) -> dict[str, Any]:
    return {
        "$and": [
            {"file_name": {"$eq": file_name}},
            {
                "$or": [
                    {"clause_id": {"$eq": "0"}},
                    {"clause_depth": {"$in": list(_OUTLINE_DEPTHS)}},
                    {"clause_depth": {"$in": [str(depth) for depth in _OUTLINE_DEPTHS]}},
                ]
            },
        ]
    }


def _whole_document_filters(file_name: str) -> dict[str, Any]:
    return {"file_name": {"$eq": file_name}}


def _covers_page(chunk: Any, page: int) -> bool:
    metadata = getattr(chunk, "metadata", None) or {}
    label = str(metadata.get("page_label") or getattr(chunk, "page_number", "") or "")
    if not label.isdigit():
        return False
    end = str(metadata.get("page_end") or "")
    last = int(end) if end.isdigit() else int(label)
    return int(label) <= page <= max(last, int(label))


def _addresses(chunk: Any, clause: str | None, page: int | None) -> bool:
    metadata = getattr(chunk, "metadata", None) or {}
    if clause and str(metadata.get("clause_id") or "") not in _clause_spellings(clause):
        return False
    return page is None or _covers_page(chunk, page)


def _clause_number(raw: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in raw.split(".")) if raw else ()
    except ValueError:
        return ()


def _clause_of(chunk: Any) -> str:
    return str((getattr(chunk, "metadata", None) or {}).get("clause_id") or "")


def _clause_sort_key(chunk: Any) -> tuple:
    raw = _clause_of(chunk)
    page = getattr(chunk, "page_number", None) or 0
    return (
        page,
        _clause_number(raw),
        _document_order(chunk),
        raw,
        _table_part(chunk),
        str(getattr(chunk, "chunk_id", "")),
    )


def _document_order(chunk: Any) -> tuple[int, int]:
    from agent.knowledge.base import section_position

    return section_position(getattr(chunk, "metadata", None))[:2]


def _table_part(chunk: Any) -> int:
    from agent.knowledge.base import section_position

    return section_position(getattr(chunk, "metadata", None))[2]


def _clause_depth(chunk: Any) -> int | None:
    raw = (getattr(chunk, "metadata", None) or {}).get("clause_depth")
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        return int(str(raw).strip())
    except ValueError:
        return None


def _is_outline_chunk(chunk: Any) -> bool:
    return _clause_of(chunk) == "0" or _clause_depth(chunk) in _OUTLINE_DEPTHS


@dataclass(frozen=True)
class OutlineEntry:
    clause_id: str
    title: str
    page: str
    depth: int
    excerpt: str = ""
    order: tuple[int, int] = (0, 0)


def _excerpt_of(chunk: Any) -> str:
    text = str(getattr(chunk, "content", "") or "")
    body = text.split("\n\n", 1)[1] if "\n\n" in text else text
    body = " ".join(body.split())
    if not body:
        return ""
    sentence = re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0]
    if len(sentence) > _EXCERPT_CHARS:
        return sentence[:_EXCERPT_CHARS].rstrip() + "…"
    return sentence


def _outline_entries(chunks: Sequence[Any]) -> list[OutlineEntry]:
    entries: dict[str, OutlineEntry] = {}
    for chunk in sorted(chunks, key=_clause_sort_key):
        metadata = getattr(chunk, "metadata", None) or {}
        clause_id = _clause_of(chunk)
        depth = _clause_depth(chunk)
        if depth not in _OUTLINE_DEPTHS or not clause_id or clause_id in entries:
            continue
        entries[clause_id] = OutlineEntry(
            clause_id=clause_id,
            title=str(metadata.get("clause_title") or "").strip(),
            page=str(metadata.get("page_label") or getattr(chunk, "page_number", "") or ""),
            depth=depth,
            excerpt=_excerpt_of(chunk) if depth == 1 else "",
            order=_document_order(chunk),
        )
    return sorted(entries.values(), key=lambda entry: (_clause_number(entry.clause_id), entry.order, entry.clause_id))


def _scope_chunks(chunks: Sequence[Any]) -> list[Any]:
    ordered = sorted(chunks, key=_clause_sort_key)
    zero = [chunk for chunk in ordered if _clause_of(chunk) == "0"]
    if zero:
        return zero
    top = [chunk for chunk in ordered if _clause_depth(chunk) == 1]
    if not top:
        return ordered[:1]
    first = min((_clause_number(_clause_of(chunk)), _document_order(chunk), _clause_of(chunk)) for chunk in top)[2]
    return [chunk for chunk in top if _clause_of(chunk) == first]


def _outline_lines(entries: Sequence[OutlineEntry], limit: int = _MAX_OUTLINE_LINES) -> list[str]:
    shown = list(entries)[:limit]
    lines = []
    for entry in shown:
        indent = "  " if entry.depth == 2 else ""
        title = f": {entry.title}" if entry.title and entry.title != entry.clause_id else ""
        page = f" (p. {entry.page})" if entry.page else ""
        excerpt = f" — {entry.excerpt}" if entry.excerpt else ""
        lines.append(f"{indent}- Punkt {entry.clause_id}{title}{page}{excerpt}")
    remaining = len(entries) - len(shown)
    if remaining > 0:
        lines.append(f"(+{remaining} more Punkte not listed)")
    return lines


def _outline_block(entries: Sequence[OutlineEntry]) -> str:
    return "\n".join(["## Gliederung", *_outline_lines(entries), "", _OUTLINE_INSTRUCTION, ""])


@dataclass(frozen=True)
class Outline:
    chunks: list[Any]
    entries: list[OutlineEntry]
    failures: list[BaseException]
    structural: bool


async def outline_for(targets: list[PassageTarget], query: str) -> Outline:
    fetched = await _fetch_all(targets, _outline_filters, query, _MAX_OUTLINE_CHUNKS)
    chunks = [chunk for chunk in fetched.chunks if _is_outline_chunk(chunk)]
    return Outline(chunks, _outline_entries(chunks), fetched.failures, fetched.structural)
