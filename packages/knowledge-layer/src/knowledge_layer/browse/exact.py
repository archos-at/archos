from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.action_outcome import ActionOutcome

from .matches import MAX_MATCH_CHUNKS
from .matches import group_matches
from .matches import pick_passages
from .messages import _context_lines
from .messages import match_snippets
from .messages import match_table
from .messages import no_match_message
from .messages import search_failed_message
from .patterns import _CAPPED_WITHOUT_OWN_MATCH
from .patterns import _NEEDS_A_ANCHOR
from .patterns import _TOO_COSTLY
from .patterns import _TOO_COSTLY_SCAN
from .patterns import MIN_PHRASE_CHARS
from .patterns import phrase_pattern
from .patterns import split_alternatives
from .patterns import stemmed_pattern
from .patterns import user_pattern
from .rows import _folder_matches
from .rows import _in_folder
from .scope import _STEMMED_NOTE
from .scope import ShelfScope
from .scope import shelf_scopes
from .search import _candidate_counts
from .search import _collection_filter
from .search import _has_literal_word
from .search import entries_on_shelf
from .text import fold
from .tool import _turn_rows
from .turn import _entry_shelf

logger = logging.getLogger("knowledge_layer.browse.tool")


async def _files_by_collection(
    search_config: Any,
    *,
    file_name: str | None,
    folder: str | None,
    doc_class: str | None,
    title_contains: str | None,
) -> dict[str, list[str]] | None:
    if not (file_name or folder or doc_class or title_contains):
        return None
    from knowledge_layer.search import _file_name_matches

    rows = await _turn_rows(search_config)
    if folder:
        resolved = _folder_matches(rows, folder)
        rows = [row for row in rows if resolved is not None and _in_folder(row, resolved)]
    if file_name:
        wanted = fold(file_name)
        rows = [
            row
            for row in rows
            if _file_name_matches(row.file_name, file_name) or wanted == fold(row.display_title or "")
        ]
    if doc_class:
        rows = [row for row in rows if row.doc_class == doc_class]
    if title_contains:
        needle = fold(title_contains)
        rows = [row for row in rows if needle in fold(f"{row.file_name} {row.display_title or ''}")]
    names: dict[str, list[str]] = {}
    for row in rows:
        names.setdefault(row.collection, []).append(row.file_name)
    return names


async def _folder_scope(search_config: Any, folder: str) -> tuple[set[str], str | None]:
    from knowledge_layer.vector_store import folder_key

    rows = await _turn_rows(search_config)
    resolved = _folder_matches(rows, folder)
    if resolved is None:
        return set(), None
    return {row.collection for row in rows if _in_folder(row, resolved)}, folder_key(resolved)


async def exact_search(
    entries: Sequence[Any],
    text: str,
    *,
    search_config: Any,
    retriever: Any,
    file_name: str | None = None,
    folder: str | None = None,
    doc_class: str | None = None,
    title_contains: str | None = None,
    filters: dict[str, Any] | None = None,
    regex_mode: bool = False,
    context: int | str | None = None,
    stemmed: bool = False,
    shelf: str | None = None,
    outcome: ActionOutcome | None = None,
) -> str:
    entries, refusal = entries_on_shelf(entries, shelf)
    if refusal:
        return refusal
    context_lines, refusal = _context_lines(context)
    if refusal:
        return refusal
    query, refusal = _query_pattern(text, regex_mode=regex_mode, stemmed=stemmed)
    if query is None:
        return refusal
    phrases, pattern, compiled = query
    narrowing = await _narrowed(
        entries,
        search_config,
        file_name=file_name,
        folder=folder,
        doc_class=doc_class,
        title_contains=title_contains,
    )
    if isinstance(narrowing, str):
        return narrowing
    entries, narrowed, folder_key = narrowing
    if regex_mode and not (narrowed is not None or folder_key) and not _has_literal_word(pattern):
        return _NEEDS_A_ANCHOR
    from knowledge_layer.search import resolve_base_collection

    base = resolve_base_collection(search_config)
    scopes = shelf_scopes(entries, await _searched_documents(search_config, narrowed, folder))
    outcome = outcome if outcome is not None else ActionOutcome()
    _note_searched(outcome, scopes)
    filters_by_collection = _filters_by_collection(entries, base, search_config, filters, narrowed, folder_key)
    return await _search(
        retriever,
        entries,
        phrases,
        pattern,
        filters_by_collection,
        compiled=compiled,
        regex_mode=regex_mode,
        context=context_lines,
        stemmed=stemmed and not regex_mode,
        scopes=scopes,
        outcome=outcome,
    )


def _note_searched(outcome: ActionOutcome, scopes: Sequence[ShelfScope]) -> None:
    counted = [scope.documents for scope in scopes if scope.documents is not None]
    outcome.searched = sum(counted) if counted else None


def _filters_by_collection(
    entries: Sequence[Any],
    base: str,
    search_config: Any,
    filters: dict[str, Any] | None,
    narrowed: dict[str, list[str]] | None,
    folder_key: str | None,
) -> dict[str, dict[str, Any] | None]:
    return {
        entry.collection: _collection_filter(
            entry.collection,
            base=base,
            search_config=search_config,
            caller_filters=filters,
            files=None if narrowed is None else narrowed[entry.collection],
            folder_key=folder_key,
        )
        for entry in entries
    }


def _query_pattern(
    text: str, *, regex_mode: bool, stemmed: bool
) -> tuple[tuple[list[str], str, Any] | None, str | None]:
    if regex_mode:
        pattern = text.strip()
        phrases = [pattern]
        compiled, refusal = user_pattern(text)
        if compiled is None:
            return None, refusal
        return (phrases, pattern, compiled), None
    phrases = split_alternatives(text)
    if not phrases:
        return None, f"Provide a `query` of at least {MIN_PHRASE_CHARS} characters: the literal word or phrase to find."
    pattern = stemmed_pattern(phrases) if stemmed else phrase_pattern(phrases)
    if pattern is None:
        return None, (
            "`query` is too long for the exact search: it finds a word or a short phrase, not a sentence. "
            "Shorten it to the words that must appear literally."
        )
    return (phrases, pattern, re.compile(pattern)), None


async def _narrowed(
    entries: Sequence[Any],
    search_config: Any,
    *,
    file_name: str | None,
    folder: str | None,
    doc_class: str | None,
    title_contains: str | None,
) -> tuple[Sequence[Any], dict[str, list[str]] | None, str | None] | str:
    narrowed = await _files_by_collection(
        search_config, file_name=file_name, folder=None, doc_class=doc_class, title_contains=title_contains
    )
    folder_key: str | None = None
    if folder:
        in_folder, folder_key = await _folder_scope(search_config, folder)
        entries = [entry for entry in entries if entry.collection in in_folder]
    if narrowed is not None:
        entries = [entry for entry in entries if entry.collection in narrowed]
    if (narrowed is not None or folder) and not entries:
        return (
            "No file in scope matches that narrowing (`file_name`, `folder`, `doc_class`, "
            "`title_contains`). `list_files` shows what exists."
        )
    return entries, narrowed, folder_key


async def _searched_documents(search_config: Any, narrowed: Mapping[str, Sequence[str]] | None, folder: str | None):
    rows = await _turn_rows(search_config)
    resolved = _folder_matches(rows, folder) if folder else None
    counts: dict[str, int] = {}
    for row in rows:
        if resolved is not None and not _in_folder(row, resolved):
            continue
        if narrowed is not None and row.file_name not in narrowed.get(row.collection, ()):
            continue
        counts[row.collection] = counts.get(row.collection, 0) + 1
    return counts


async def _read_collection(
    retriever: Any,
    entry: Any,
    pattern: str,
    filters_by_collection: dict[str, dict[str, Any] | None],
    read_options: dict[str, Any],
) -> tuple[list[Any] | None, bool]:
    chunks = await retriever.find_text(
        entry.collection,
        pattern,
        filters=filters_by_collection.get(entry.collection),
        limit=MAX_MATCH_CHUNKS,
        **read_options,
    )
    if chunks is None:
        return None, False
    for chunk in chunks:
        chunk.metadata.setdefault("collection", entry.collection)
        if (shelf := _entry_shelf(entry)) is not None:
            chunk.metadata.setdefault("shelf", shelf)
    return chunks, len(chunks) >= MAX_MATCH_CHUNKS


@dataclass
class _Read:
    chunks: list[Any] = field(default_factory=list)
    truncated: bool = False
    capped: list[Any] = field(default_factory=list)
    answered: int = 0
    failed: list[str] = field(default_factory=list)


def _collected(entries: Sequence[Any], results: Sequence[Any]) -> _Read | str:
    from knowledge_layer.vector_store import PatternTooCostly

    read = _Read()
    for entry, result in zip(entries, results, strict=True):
        if isinstance(result, PatternTooCostly):
            return _TOO_COSTLY_SCAN if result.scan else _TOO_COSTLY
        if isinstance(result, BaseException):
            logger.warning("exact search: %s failed: %s", entry.collection, result)
            read.failed.append(entry.collection)
            continue
        found, hit_cap = result
        if found is None:
            continue
        read.answered += 1
        read.chunks.extend(found)
        read.truncated = read.truncated or hit_cap
        if hit_cap:
            read.capped.append(entry)
    return read


async def _read_all(
    retriever: Any,
    entries: Sequence[Any],
    phrases: Sequence[str],
    pattern: str,
    filters_by_collection: dict[str, dict[str, Any] | None],
    regex_mode: bool,
    stemmed: bool,
) -> _Read | str:
    read_options: dict[str, Any] = {"user_regex": True} if regex_mode else {}
    if stemmed:
        read_options["stem_phrases"] = list(phrases)

    results = await asyncio.gather(
        *(_read_collection(retriever, entry, pattern, filters_by_collection, read_options) for entry in entries),
        return_exceptions=True,
    )
    read = _collected(entries, results)
    if isinstance(read, str) or read.answered:
        return read
    if read.failed:
        return search_failed_message(phrases, read.failed, regex_mode=regex_mode)
    return "Full-text search is not available in this environment. Use `knowledge_search`."


def _record(outcome: ActionOutcome, groups: list[Any], read: _Read) -> None:
    outcome.record(
        sum(group.occurrences for group in groups),
        documents=len(groups),
        collections=[group.collection for group in groups],
    )
    outcome.failed = bool(read.failed) and not groups


async def _search(
    retriever: Any,
    entries: Sequence[Any],
    phrases: Sequence[str],
    pattern: str,
    filters_by_collection: dict[str, dict[str, Any] | None],
    *,
    compiled: Any = None,
    regex_mode: bool = False,
    context: int | None = None,
    stemmed: bool = False,
    scopes: Sequence[ShelfScope] = (),
    outcome: ActionOutcome | None = None,
) -> str:
    from knowledge_layer.vector_store import USER_REGEX_SCAN_SECONDS
    from knowledge_layer.vector_store import USER_REGEX_TIMEOUT

    read = await _read_all(retriever, entries, phrases, pattern, filters_by_collection, regex_mode, stemmed)
    if isinstance(read, str):
        return read

    timeout = USER_REGEX_TIMEOUT if regex_mode else None
    deadline = time.monotonic() + USER_REGEX_SCAN_SECONDS if regex_mode else None
    try:
        groups = group_matches(
            read.chunks,
            compiled if regex_mode else pattern,
            timeout=timeout,
            store_decides=stemmed,
            deadline=deadline,
            collect_strings=regex_mode,
        )
    except TimeoutError:
        return _TOO_COSTLY_SCAN if deadline is not None and time.monotonic() >= deadline else _TOO_COSTLY
    if not groups and read.truncated:
        return _CAPPED_WITHOUT_OWN_MATCH
    if outcome is not None:
        _record(outcome, groups, read)
    if not groups:
        return no_match_message(phrases, read.answered, read.failed, regex_mode=regex_mode, scopes=scopes)
    return await _matched(
        retriever,
        groups,
        phrases,
        pattern,
        filters_by_collection,
        read,
        compiled=compiled,
        regex_mode=regex_mode,
        context=context,
        stemmed=stemmed,
        scopes=scopes,
        timeout=timeout,
    )


async def _matched(
    retriever: Any,
    groups: list[Any],
    phrases: Sequence[str],
    pattern: str,
    filters_by_collection: dict[str, dict[str, Any] | None],
    read: _Read,
    *,
    compiled: Any,
    regex_mode: bool,
    context: int | None,
    stemmed: bool,
    scopes: Sequence[ShelfScope],
    timeout: Any,
) -> str:
    from agent.knowledge.restricted_use import note_collections_read
    from knowledge_layer.read_passage import _passage_result
    from knowledge_layer.search import format_results

    note_collections_read(group.collection for group in groups)
    passages = pick_passages(groups)
    query = " | ".join(phrases)
    candidates = await _candidate_counts(retriever, read.capped, pattern, filters_by_collection, regex_mode=regex_mode)
    trailer = match_table(
        groups,
        phrases,
        truncated=read.truncated,
        failed=read.failed,
        regex_mode=regex_mode,
        candidates=candidates,
        scopes=scopes,
    )
    if stemmed:
        trailer = f"{_STEMMED_NOTE}\n{trailer}"
    if context is not None:
        try:
            snippets = match_snippets(groups, compiled if regex_mode else re.compile(pattern), context, timeout=timeout)
        except TimeoutError:
            return _TOO_COSTLY
        trailer = f"{trailer}\n\n{snippets}" if snippets else trailer
    formatted = await asyncio.to_thread(format_results, _passage_result(passages, query), query, trailer=trailer)
    logger.info("exact search: %r matched %d file(s)", query, len(groups))
    return formatted
