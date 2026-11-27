from __future__ import annotations

import re
import time
from collections import Counter
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.source_kinds import canonical_shelf_value
from knowledge_layer.chunk_positions import OwnText
from knowledge_layer.chunk_positions import own_matches
from knowledge_layer.chunk_positions import own_texts

from .text import _pages_label
from .text import _shorten
from .text import fold

MAX_MATCH_CHUNKS = 500

MAX_MATCH_PASSAGES = 8

MAX_DISTINCT_MATCHES = 20

MAX_DISTINCT_CHARS = 60

MAX_DISTINCT_FILES = 3

MAX_DISTINCT_PAGES = 5

MAX_TRACKED_STRINGS = 200


def _occurrences(body: str, pattern: Any, timeout: float | None = None) -> int:
    if timeout is None:
        return sum(1 for match in pattern.finditer(body) if match.end() > match.start())
    return sum(1 for match in pattern.finditer(body, timeout=timeout) if match.end() > match.start())


def _matched_strings(own: OwnText, pattern: Any, timeout: float | None = None) -> list[str]:
    return [" ".join(match.group().split()) for match in own_matches(own, pattern, timeout)]


@dataclass
class FileMatches:
    file_name: str
    shelf: str | None
    collection: str
    chunks: list[Any] = field(default_factory=list)
    occurrences: int = 0
    strings: dict[str, list[Any]] = field(default_factory=dict)
    strings_cut: bool = False
    own: dict[str, OwnText] = field(default_factory=dict)
    document_id: str | None = None
    label: str = ""

    @property
    def shown(self) -> str:
        return self.label or self.file_name

    def note_strings(self, found: Sequence[str], page: int | None) -> None:
        for text in found:
            entry = self.strings.get(fold(text))
            if entry is None:
                if len(self.strings) >= MAX_TRACKED_STRINGS:
                    self.strings_cut = True
                    continue
                entry = self.strings[fold(text)] = [text, 0, set()]
            entry[1] += 1
            if page:
                entry[2].add(page)

    @property
    def pages(self) -> list[int]:
        return sorted({chunk.page_number for chunk in self.chunks if getattr(chunk, "page_number", None)})


def label_namesakes(groups: Sequence[FileMatches]) -> None:
    from knowledge_layer.document_address import citation_form
    from knowledge_layer.search import hit_folder_path
    from knowledge_layer.search import resolve_folder_paths

    shared = Counter((group.collection, fold(group.file_name)) for group in groups)
    namesakes = [group for group in groups if shared[(group.collection, fold(group.file_name))] > 1]
    if not namesakes:
        return
    folders = resolve_folder_paths([group.chunks[0] for group in namesakes])
    for group in namesakes:
        folder = hit_folder_path(group.chunks[0], folders)
        group.label = (
            citation_form(folder, group.file_name)
            if folder is not None
            else f"{group.file_name} (Document-ID: {group.document_id})"
        )


def _add_match(groups: dict[tuple[str, str], FileMatches], chunk: Any, own: str, count: int, found: list[str]) -> None:
    metadata = getattr(chunk, "metadata", None) or {}
    collection = str(metadata.get("collection") or "")
    document_id = str(metadata.get("document_id") or "") or None
    key = (collection, f"id:{document_id}" if document_id else chunk.file_name)
    group = groups.get(key)
    if group is None:
        group = groups[key] = FileMatches(
            chunk.file_name,
            canonical_shelf_value(str(metadata["shelf"])) if metadata.get("shelf") else None,
            collection,
            document_id=document_id,
        )
    group.chunks.append(chunk)
    group.own[chunk.chunk_id] = own
    group.occurrences += count
    if found:
        group.note_strings(found, getattr(chunk, "page_number", None))


def group_matches(
    chunks: Iterable[Any],
    pattern: Any,
    *,
    timeout: float | None = None,
    store_decides: bool = False,
    deadline: float | None = None,
    collect_strings: bool = False,
) -> list[FileMatches]:
    compiled = pattern if hasattr(pattern, "finditer") else re.compile(pattern)
    groups: dict[tuple[str, str], FileMatches] = {}
    chunks = list(chunks)
    for chunk, own in zip(chunks, own_texts(chunks), strict=True):
        if deadline is not None and timeout is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("the count ran out of time")
            timeout = min(timeout, remaining)
        found: list[str] = _matched_strings(own, compiled, timeout) if collect_strings else []
        count = len(found) if collect_strings else sum(1 for _ in own_matches(own, compiled, timeout))
        if store_decides and not count and not _occurrences(getattr(chunk, "content", "") or "", compiled, timeout):
            count = 1
        if not count:
            continue
        _add_match(groups, chunk, own, count, found)
    ordered = sorted(
        groups.values(), key=lambda group: (group.shelf == "base", -group.occurrences, fold(group.file_name))
    )
    for group in ordered:
        group.chunks.sort(key=lambda chunk: (getattr(chunk, "page_number", None) or 0, chunk.chunk_id))
    return ordered


def pick_passages(groups: Sequence[FileMatches], limit: int = MAX_MATCH_PASSAGES) -> list[Any]:
    picked: list[Any] = []
    depth = 0
    while len(picked) < limit and any(depth < len(group.chunks) for group in groups):
        for group in groups:
            if depth < len(group.chunks) and len(picked) < limit:
                picked.append(group.chunks[depth])
        depth += 1
    return picked


def distinct_matches(groups: Sequence[FileMatches]) -> tuple[list[tuple[str, int, list[str], list[int]]], bool]:
    merged: dict[str, list[Any]] = {}
    cut = False
    for group in groups:
        cut = cut or group.strings_cut
        for key, (text, count, pages) in group.strings.items():
            entry = merged.setdefault(key, [text, 0, [], set()])
            entry[1] += count
            entry[2].append(group.shown)
            entry[3].update(pages)
    ranked = sorted(merged.values(), key=lambda entry: (-entry[1], fold(entry[0])))
    return [(text, count, files, sorted(pages)) for text, count, files, pages in ranked], cut


def _distinct_lines(groups: Sequence[FileMatches]) -> list[str]:
    ranked, cut = distinct_matches(groups)
    if not ranked:
        return []
    floor = "at least " if cut else ""
    lines = [f"Distinct matches: {floor}{len(ranked)} (each different matched string, with its count):"]
    for text, count, files, pages in ranked[:MAX_DISTINCT_MATCHES]:
        names = ", ".join(files[:MAX_DISTINCT_FILES]) + (
            f" … (+{len(files) - MAX_DISTINCT_FILES} files)" if len(files) > MAX_DISTINCT_FILES else ""
        )
        where = _pages_label(pages, MAX_DISTINCT_PAGES)
        lines.append(f"- `{_shorten(text, MAX_DISTINCT_CHARS)}`: {count}× in {names}{where}")
    if len(ranked) > MAX_DISTINCT_MATCHES:
        lines.append(f"… and {len(ranked) - MAX_DISTINCT_MATCHES} more distinct strings, the rarest.")
    return lines
