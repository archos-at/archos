from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from knowledge_layer.vector_store import DOCUMENT_ID_FIELD

GROUP_BY_DOCUMENT = "document"

GROUP_OVERFETCH = 4


@dataclass(frozen=True)
class DocumentGroup:
    best: Any
    passages: int
    pages: tuple[int, ...]


def document_key(chunk: Any) -> tuple[str, ...]:
    metadata = getattr(chunk, "metadata", None) or {}
    document_id = metadata.get(DOCUMENT_ID_FIELD)
    if document_id:
        return ("id", str(document_id))
    return ("file", str(metadata.get("collection") or ""), str(getattr(chunk, "file_name", None) or ""))


def _page(chunk: Any) -> int | None:
    page = getattr(chunk, "page_number", None)
    return page if isinstance(page, int) and not isinstance(page, bool) and page > 0 else None


def _distinct(chunks: Iterable[Any]) -> list[Any]:
    seen: set[Any] = set()
    out: list[Any] = []
    for chunk in chunks:
        if chunk is None:
            continue
        key = getattr(chunk, "chunk_id", None) or id(chunk)
        if key in seen:
            continue
        seen.add(key)
        out.append(chunk)
    return out


def group_by_document(ordered: Sequence[Any], pool: Sequence[Any] = ()) -> list[DocumentGroup]:
    candidates = _distinct([*ordered, *pool])
    best: dict[tuple[str, ...], Any] = {}
    counts: dict[tuple[str, ...], int] = {}
    pages: dict[tuple[str, ...], set[int]] = {}
    for chunk in candidates:
        key = document_key(chunk)
        best.setdefault(key, chunk)
        counts[key] = counts.get(key, 0) + 1
        page = _page(chunk)
        if page is not None:
            pages.setdefault(key, set()).add(page)
    return [DocumentGroup(chunk, counts[key], tuple(sorted(pages.get(key, ())))) for key, chunk in best.items()]


_PAGES_SHOWN = 8


def _pages_cell(pages: tuple[int, ...]) -> str:
    if not pages:
        return "–"
    shown = ", ".join(str(page) for page in pages[:_PAGES_SHOWN])
    rest = len(pages) - _PAGES_SHOWN
    return f"{shown} (+{rest} more)" if rest > 0 else shown


def render_document_groups(groups: Sequence[DocumentGroup], pool_size: int) -> str:
    if not groups:
        return ""
    lines = [
        f"## Documents ({len(groups)}, grouped from {pool_size} ranked passages)",
        "| # | Document | Passages in pool | Pages |",
        "|---|---|---|---|",
    ]
    for number, group in enumerate(groups, start=1):
        name = str(getattr(group.best, "file_name", None) or "?").replace("|", "/")
        lines.append(f"| {number} | {name} | {group.passages} | {_pages_cell(group.pages)} |")
    lines.append(
        "Each document's passage above is its best one. The counts are lower bounds over the ranked pool; "
        "a literal search counts every mention, and reading a document gives its text."
    )
    return "\n".join(lines)
