from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .revisions import MAX_CHAIN_CANDIDATES
from .revisions import _chain_candidates
from .revisions import _resolve_chain
from .rows import _SHELF_LABELS
from .rows import USER_SHELVES
from .rows import FileRow
from .text import fold

logger = logging.getLogger("knowledge_layer.browse.tool")

_PREVIOUS_WORDS = frozenset({"", "vorige", "vorherige", "letzte", "previous", "prev"})


@dataclass(frozen=True)
class ComparePair:
    first: FileRow
    second: FileRow
    related: bool


def _other_document(
    rows: Sequence[FileRow],
    members: Sequence[FileRow],
    target: str,
    *,
    shelf: str | None,
    default_shelves: Sequence[str],
) -> tuple[FileRow | None, str]:
    shelves = (shelf,) if shelf else tuple(default_shelves)
    where = " and ".join(_SHELF_LABELS.get(name, name) for name in shelves)
    chain = {(row.collection, row.file_name) for row in members}
    scoped = [
        row
        for row in rows
        if (row.shelf in shelves or (not shelf and row.shelf is None)) and (row.collection, row.file_name) not in chain
    ]
    candidates = _chain_candidates(scoped, target)
    fassungen = ", ".join(row.file_name for row in members[:MAX_CHAIN_CANDIDATES])
    if not candidates:
        return None, (
            f'"{target}" is neither a Fassung of this document nor another file on {where}. Its Fassungen: '
            f"{fassungen}. Find the exact name of the other file with `list_files(name_contains=…)`."
        )
    if len(candidates) > 1:
        names = ", ".join(row.file_name for row in candidates[:MAX_CHAIN_CANDIDATES])
        rest = len(candidates) - MAX_CHAIN_CANDIDATES
        return None, (
            f'"{target}" matches several files on {where}: {names}{f" and {rest} more" if rest > 0 else ""}. '
            "Name one exactly in `compare_to`."
        )
    return candidates[0], ""


def resolve_compare(
    rows: Sequence[FileRow],
    wanted: str,
    compare_to: str | None,
    *,
    shelf: str | None = None,
    default_shelves: Sequence[str] = USER_SHELVES,
) -> tuple[ComparePair | None, str]:
    members, refusal = _resolve_chain(rows, wanted, shelf=shelf, default_shelves=default_shelves)
    if refusal:
        return None, refusal
    exact = [row for row in members if fold(wanted.strip()) in (fold(row.file_name), fold(row.display_title or ""))]
    anchor = exact[0] if len(exact) == 1 else members[0]
    position = members.index(anchor)
    target = (compare_to or "").strip()
    if fold(target) in _PREVIOUS_WORDS:
        if len(members) < 2:
            return None, (
                f'Of "{wanted.strip()}" there is only this one file on this shelf, so there is no previous Fassung '
                "to compare it with. Earlier uploads under the SAME file name are not in the index yet; what changed "
                "there is in the change note of `list_files(revisions_of=…)`. To compare it with a different "
                "document, name that file in `compare_to`."
            )
        other = members[position + 1] if position + 1 < len(members) else members[position - 1]
    else:
        candidates = _chain_candidates(members, target)
        if len(candidates) > 1:
            names = ", ".join(row.file_name for row in members[:MAX_CHAIN_CANDIDATES])
            return None, f'"{target}" matches several Fassungen; name one exactly: {names}.'
        if not candidates:
            outside, refusal = _other_document(rows, members, target, shelf=shelf, default_shelves=default_shelves)
            if outside is None:
                return None, refusal
            return ComparePair(first=anchor, second=outside, related=False), ""
        other = candidates[0]
    if other is anchor:
        return None, "That is the same file twice. Name a different file in `compare_to`."
    newer, older = (anchor, other) if position < members.index(other) else (other, anchor)
    return ComparePair(first=older, second=newer, related=True), ""


def _change_line_between(older: FileRow, newer: FileRow) -> str | None:
    if newer.change_summary and newer.change_basis == older.file_name:
        return newer.change_summary
    return None


def _stored_chunks(collection: str, file_name: str) -> tuple[list[Any], list[Any]] | None:
    from agent.knowledge.collection_pages import read_chunks
    from agent.knowledge.revision_diff import chunk_from_store
    from agent.knowledge.table_diff import table_chunk_from_store

    stored = read_chunks(collection, file_name)
    if stored is None:
        return None
    return (
        [chunk for text, meta in stored if (chunk := chunk_from_store(text, meta)) is not None],
        [table for text, meta in stored if (table := table_chunk_from_store(text, meta)) is not None],
    )


def _licensed(row: FileRow) -> bool:
    from agent.common.licensed_text import licence_from_metadata
    from knowledge_layer.estate import document_licence

    terms = licence_from_metadata(
        {
            "licence_class": row.licence_class,
            "quote_max_chars": row.quote_max_chars,
            "ai_processing_attested": row.ai_processing_attested,
        }
    ) or document_licence(row.collection, row.file_name)
    return terms is not None and terms.licensed


async def compare_files(pair: ComparePair) -> str:
    from agent.common.tool_calls import FETCH_FAILED_MARKER
    from agent.knowledge.restricted_use import note_collections_read
    from agent.knowledge.revision_diff import diff_revisions
    from agent.knowledge.revision_diff import render_diff
    from agent.knowledge.table_diff import diff_tables

    first, second = pair.first, pair.second
    try:
        licensed = await asyncio.gather(*(asyncio.to_thread(_licensed, row) for row in (first, second)))
        first_stored, second_stored = await asyncio.gather(
            asyncio.to_thread(_stored_chunks, first.collection, first.file_name),
            asyncio.to_thread(_stored_chunks, second.collection, second.file_name),
        )
    except Exception:  # noqa: BLE001 - an outage is said as one, never as "not in the index"
        logger.warning("compare_files: the index did not answer", exc_info=True)
        return (
            f'{FETCH_FAILED_MARKER} The index is not reachable right now; "{first.file_name}" and '
            f'"{second.file_name}" were not compared. Try once more; if it fails again, say so and claim no '
            "difference."
        )
    held = [row.file_name for row, is_licensed in zip((first, second), licensed, strict=True) if is_licensed]
    if held:
        names = " and ".join(f'"{name}"' for name in held)
        return (
            f"{names} is a licensed copy, whose text is only given as a cited passage, so it was not compared "
            "line by line. Read the passages in question with `read_passage` or `knowledge_search(file_name=…)` "
            "and hold them against the other file yourself, citing both."
        )
    missing = [row.file_name for row, stored in ((first, first_stored), (second, second_stored)) if stored is None]
    if missing:
        names = " and ".join(f'"{name}"' for name in missing)
        return (
            f"The read content of {names} is not in the index, "
            "so nothing can be compared. If the file is still being read, try again later."
        )
    note_collections_read({first.collection, second.collection})
    first_chunks, first_tables = first_stored or ([], [])
    second_chunks, second_tables = second_stored or ([], [])
    diff = diff_revisions(
        first_chunks,
        second_chunks,
        older_facts=first.revision_facts,
        newer_facts=second.revision_facts,
    )
    return render_diff(
        diff,
        first.file_name,
        second.file_name,
        change_summary=_change_line_between(first, second) if pair.related else None,
        tables=diff_tables(first_tables, second_tables),
        related=pair.related,
    )
