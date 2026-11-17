from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

from knowledge_layer.chunk_positions import body
from knowledge_layer.chunk_positions import repeated_head
from knowledge_layer.chunk_positions import split_prefix

ORDER_FILTERS = "order"

LABEL_FILTERS = "label"

_FILTER_KINDS = (ORDER_FILTERS, LABEL_FILTERS)

_MAX_PASSAGE_CHUNKS = 12

_MAX_READ_CHARS = 24_000

_MAX_RANGE_PAGES = 30

_PAGE_SPAN_WINDOW = 8


def _range_filters(file_name: str, first: int, last: int | None, window: int = _PAGE_SPAN_WINDOW) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = [
        {"file_name": {"$eq": file_name}},
        {"reading_order": {"$gte": max(1, first - window)}},
    ]
    if last is not None:
        clauses.append({"reading_order": {"$lte": last}})
    return {"$and": clauses}


def _range_label_filters(file_name: str, first: int, last: int, window: int = _PAGE_SPAN_WINDOW) -> dict[str, Any]:
    labels = [str(number) for number in range(max(1, first - window), last + 1)]
    return {"$and": [{"file_name": {"$eq": file_name}}, {"page_label": {"$in": labels}}]}


def _filters_for(kind: str, first: int, last: int | None, window: int = _PAGE_SPAN_WINDOW):
    if kind == LABEL_FILTERS and last is not None:
        return lambda file_name: _range_label_filters(file_name, first, last, window)
    return lambda file_name: _range_filters(file_name, first, last, window)


def _page_span(chunk: Any) -> tuple[int, int] | None:
    metadata = getattr(chunk, "metadata", None) or {}
    label = str(metadata.get("page_label") or getattr(chunk, "page_number", "") or "")
    if not label.isdigit():
        return None
    end = str(metadata.get("page_end") or "")
    return int(label), max(int(end) if end.isdigit() else int(label), int(label))


def _meets_range(chunk: Any, first: int, last: int | None) -> bool:
    span = _page_span(chunk)
    if span is None:
        return False
    return span[1] >= first and (last is None or span[0] <= last)


def _chunk_ordinal(chunk: Any) -> int | None:
    ordinal = (getattr(chunk, "metadata", None) or {}).get("chunk_ordinal")
    return ordinal if isinstance(ordinal, int) and not isinstance(ordinal, bool) else None


def _chunk_position(chunk: Any) -> tuple[int, int, int, int, int, int, str]:
    from agent.knowledge.base import document_position

    return document_position(getattr(chunk, "metadata", None), getattr(chunk, "chunk_id", ""))


def _range_order(chunks: Sequence[Any]) -> list[Any]:
    return sorted(chunks, key=_chunk_position)


def _without_overlap(chunks: Sequence[Any]) -> list[Any]:
    result: list[Any] = []
    previous: Any = None
    for chunk in chunks:
        trimmed = chunk
        if previous is not None and _neighbours(previous, chunk):
            start = split_prefix(chunk)[0]
            cut = repeated_head(body(previous), chunk.content[start:])
            if cut:
                content = chunk.content[:start] + chunk.content[start + cut :].lstrip()
                trimmed = chunk.model_copy(update={"content": content})
        result.append(trimmed)
        previous = chunk
    return result


def _is_text(chunk: Any) -> bool:
    kind = getattr(chunk, "content_type", None)
    return getattr(kind, "value", kind) in (None, "text")


def _neighbours(previous: Any, chunk: Any) -> bool:
    if not (_is_text(previous) and _is_text(chunk)) or previous.file_name != chunk.file_name:
        return False
    before, after = previous.metadata or {}, chunk.metadata or {}
    if before.get("collection") != after.get("collection") or before.get("chunking") != after.get("chunking"):
        return False
    before_ordinal, after_ordinal = _chunk_ordinal(previous), _chunk_ordinal(chunk)
    return before_ordinal is not None and after_ordinal is not None and after_ordinal - before_ordinal == 1


def _is_range_text(value: Any) -> bool:
    return (
        isinstance(value, str) and re.search(r"\d\s*(?:-|\u2013|\u2014|bis|to)\s*\d", value, re.IGNORECASE) is not None
    )


def _within_budget(chunks: Sequence[Any], cap: int) -> tuple[list[Any], bool]:
    kept: list[Any] = []
    size = 0
    for chunk in chunks:
        if kept and size + len(chunk.content) > cap:
            return kept, True
        kept.append(chunk)
        size += len(chunk.content)
    return kept, False


def _in_range(chunks: Sequence[Any], first: int, last: int | None, start: tuple[Any, ...] | None) -> list[Any]:
    return [
        chunk
        for chunk in chunks
        if _meets_range(chunk, first, last) and (start is None or _chunk_position(chunk) > tuple(start))
    ]


def _range_trailer(document: str, kept: Sequence[Any], first: int, last: int | None, cursor: str | None) -> str:
    spans = [span for chunk in kept if (span := _page_span(chunk)) is not None]
    reached = max((end for _start, end in spans), default=first)
    upto = reached if last is None else min(reached, last)
    if cursor is not None:
        asked = "" if last is None else f" of the requested {_page_range_text(first, last)}"
        return (
            f"Read pages {_page_range_text(first, max(first, upto))}{asked}; the rest follows. Continue: "
            f"read_passage(document={json.dumps(document, ensure_ascii=False)}, cursor={json.dumps(cursor)}), "
            "or ask for several ranges in one round."
        )
    wanted = range(first, (last if last is not None else upto) + 1)
    covered = {page for start, end in spans for page in range(start, end + 1)}
    blank = [page for page in wanted if page not in covered]
    line = f"Read pages {_page_range_text(first, wanted[-1])}."
    if blank and len(blank) <= 10:
        line += f" No text on page{'s' if len(blank) > 1 else ''} {', '.join(map(str, blank))}."
    return line


def _passage_filters(file_name: str, clause: str | None, page: int | None) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = [{"file_name": {"$eq": file_name}}]
    if clause:
        spellings = _clause_spellings(clause)
        clauses.append({"clause_id": {"$eq": clause} if len(spellings) == 1 else {"$in": spellings}})
    if page is not None:
        clauses.append({"page_label": {"$in": _page_window(page)}})
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def _locus_label(document: str, clause: str | None, page: int | None, pages: tuple[int, int] | None = None) -> str:
    parts = [document]
    if clause:
        parts.append(f"Pkt. {clause}")
    if page is not None:
        parts.append(f"S. {page}")
    if pages is not None:
        parts.append(f"S. {_page_range_text(*pages)}")
    return ", ".join(parts)


def _page_range_text(first: int, last: int) -> str:
    return str(first) if first == last else f"{first}\u2013{last}"


def _clause_spellings(clause: str) -> list[str]:
    from knowledge_layer.ingest import normalise_locator

    return sorted({clause, normalise_locator(clause)})


def _page_window(page: int) -> list[str]:
    return [str(number) for number in range(max(1, page - _PAGE_SPAN_WINDOW), page + 1)]
