from __future__ import annotations

import logging
from datetime import UTC
from datetime import datetime
from urllib.parse import parse_qs
from urllib.parse import urlparse

from agent.citations.citation_keys import ParsedURL
from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import key_file_names
from agent.citations.citation_keys import parse_citation_key
from agent.citations.citation_keys import parse_citation_ref
from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.common.grounding_block import SourceRegion

logger = logging.getLogger(__name__)


MAX_REGIONS_PER_SOURCE = 6


def _merge_regions(entry: SourceEntry, regions: list[SourceRegion]) -> None:
    for region in regions:
        if len(entry.regions) >= MAX_REGIONS_PER_SOURCE:
            return
        if region not in entry.regions:
            entry.regions.append(region)


def _merge_passage(existing: SourceEntry, entry: SourceEntry) -> None:
    if entry.chunk_text:
        if not existing.chunk_text:
            existing.chunk_text = entry.chunk_text
        elif entry.chunk_text not in existing.chunk_text:
            existing.chunk_text = f"{existing.chunk_text}\n\n{entry.chunk_text}"
    if existing.clause is None and entry.clause:
        existing.clause = entry.clause
    existing.work_id = existing.work_id or entry.work_id
    existing.edition_id = existing.edition_id or entry.edition_id
    existing.public_url = existing.public_url or entry.public_url
    existing.revision_date = existing.revision_date or entry.revision_date
    if entry.score is not None and (existing.score is None or entry.score > existing.score):
        existing.score = entry.score
    _merge_regions(existing, entry.regions)
    if entry.read and entry.read not in (existing.read or ""):
        existing.read = f"{existing.read}\n{entry.read}" if existing.read else entry.read
    existing.document_id = existing.document_id or entry.document_id
    existing.folder_path = existing.folder_path or entry.folder_path


NameIdentity = tuple[str | None, str, int | None]


def _folder_key(entry: SourceEntry) -> str:
    return (entry.folder_path or "").strip("/").casefold()


def bare_file_name(entry: SourceEntry) -> str:
    filename, _page = parse_citation_key(entry.citation_key or "")
    folder = (entry.folder_path or "").strip("/")
    if folder and filename.casefold().startswith(f"{folder.casefold()}/"):
        return filename[len(folder) + 1 :]
    return filename


class SourceRegistry:
    def __init__(self) -> None:
        self._urls: dict[str, SourceEntry] = {}
        self._parsed_urls: dict[str, ParsedURL] = {}
        self._citation_keys: list[SourceEntry] = []
        self._by_name: dict[NameIdentity, list[SourceEntry]] = {}
        self._by_document: dict[tuple[str, int | None], SourceEntry] = {}
        self._all: list[SourceEntry] = []
        self.licensed_text: dict[str, str] = {}

    def keep_licensed_text(self, key: str, body: str) -> None:
        held = self.licensed_text.get(key)
        self.licensed_text[key] = body if not held else held if body in held else f"{held}\n\n{body}"

    def for_turn(self) -> SourceRegistry:
        self.licensed_text.clear()
        return self

    @staticmethod
    def _identity(entry: SourceEntry) -> NameIdentity:
        _filename, page = parse_citation_key(entry.citation_key or "")
        collection = (entry.collection or "").strip().lower() or None
        return (collection, bare_file_name(entry).lower(), page)

    def _held(self, entry: SourceEntry) -> SourceEntry | None:
        identity = self._identity(entry)
        named = self._by_name.get(identity, [])
        folder = _folder_key(entry)
        if entry.document_id:
            held = self._by_document.get((entry.document_id, identity[2]))
            unclaimed = (
                existing
                for existing in named
                if not existing.document_id and (not folder or _folder_key(existing) in ("", folder))
            )
            return held or next(unclaimed, None)
        return next((existing for existing in named if _folder_key(existing) == folder), named[0] if named else None)

    def _index(self, entry: SourceEntry) -> None:
        identity = self._identity(entry)
        named = self._by_name.setdefault(identity, [])
        if not any(existing is entry for existing in named):
            named.append(entry)
        if entry.document_id:
            self._by_document.setdefault((entry.document_id, identity[2]), entry)

    def add(self, entry: SourceEntry) -> None:
        added = False
        if entry.retrieved_at is None and (entry.url or entry.public_url):
            entry.retrieved_at = datetime.now(UTC).date().isoformat()
        if entry.url:
            raw = entry.url
            normalized = normalize_url(raw)
            if normalized not in self._urls:
                self._urls[normalized] = entry
                parsed = urlparse(normalized)
                self._parsed_urls[normalized] = ParsedURL(
                    host=parsed.netloc,
                    path=parsed.path,
                    path_segments=[s for s in parsed.path.split("/") if s],
                    query=parse_qs(parsed.query, keep_blank_values=True),
                    entry=entry,
                )
                added = True
            if raw != normalized:
                self._urls[raw] = self._urls[normalized]
        if entry.citation_key:
            held = self._held(entry)
            if held is None:
                self._citation_keys.append(entry)
                self._index(entry)
                added = True
            else:
                _merge_passage(held, entry)
                self._index(held)
        if added:
            self._all.append(entry)

    def has_url(self, url: str) -> bool:
        return normalize_url(url) in self._urls

    @staticmethod
    def _pick_unique(candidates: list[SourceEntry], strategy: str, url: str) -> str | None:
        if len(candidates) == 1:
            logger.debug("[CitationVerify] %s match: '%s' → '%s'", strategy, url, candidates[0].url)
            return candidates[0].url
        if len(candidates) > 1:
            logger.debug(
                "[CitationVerify] Ambiguous %s match for '%s' — %d candidates, rejecting",
                strategy,
                url,
                len(candidates),
            )
        return None

    def resolve_url(self, url: str) -> str | None:
        if url in self._urls:
            return self._urls[url].url
        normalized = normalize_url(url)
        if normalized in self._urls:
            return self._urls[normalized].url

        truncation_entries = [e for e in self._urls.values() if e.url and e.url.startswith(url)]
        result = self._pick_unique(list({e.url: e for e in truncation_entries}.values()), "truncation", url)
        if result:
            return result

        prefix_entries = [e for n, e in self._urls.items() if n.startswith(normalized)]
        result = self._pick_unique(
            list({e.url: e for e in prefix_entries}.values()),
            "prefix",
            url,
        )
        if result:
            return result

        parsed = urlparse(normalized)
        host, path = parsed.netloc, parsed.path
        same_host = [p for p in self._parsed_urls.values() if p.host == host]

        result = self._pick_unique(
            [
                p.entry
                for p in same_host
                if len(p.path_segments) >= 2 and path != p.path and path.startswith(p.path.rstrip("/") + "/")
            ],
            "child-path",
            url,
        )
        if result:
            return result

        report_qs = parse_qs(parsed.query, keep_blank_values=True)
        if report_qs:
            result = self._pick_unique(
                [
                    p.entry
                    for p in same_host
                    if p.path == path and p.query and all(p.query.get(k) == v for k, v in report_qs.items())
                ],
                "query-subset",
                url,
            )
            if result:
                return result

        return None

    def _entries_for_key(self, key: str) -> tuple[list[SourceEntry], int | None]:
        target_file, target_shelf, target_page = parse_citation_ref(key)
        named = [(parse_citation_key(e.citation_key)[0].lower(), e) for e in self._citation_keys]
        matches: list[SourceEntry] = []
        for name in key_file_names(key, target_file):
            matches = [entry for entry_name, entry in named if entry_name == name.lower()]
            if matches:
                break
        if not matches:
            matches = self._entries_named(target_file)
        if target_shelf:
            scoped = [entry for entry in matches if entry_shelf(entry) == target_shelf]
            if scoped:
                return scoped, target_page
        return matches, target_page

    def _entries_named(self, target_file: str) -> list[SourceEntry]:
        folder, _slash, leaf = target_file.strip().rpartition("/")
        wanted_folder, wanted = folder.strip("/").casefold(), leaf.casefold()
        return [
            entry
            for entry in self._citation_keys
            if bare_file_name(entry).casefold() == wanted and (not folder or _folder_key(entry) == wanted_folder)
        ]

    def has_citation_key(self, key: str) -> bool:
        return bool(self._entries_for_key(key)[0])

    def entry_for_url(self, url: str) -> SourceEntry | None:
        entry = self._urls.get(url)
        if entry is not None:
            return entry
        return self._urls.get(normalize_url(url))

    def entry_for_citation_key(self, key: str) -> SourceEntry | None:
        matches, target_page = self._entries_for_key(key)
        if target_page is not None:
            for entry in matches:
                if parse_citation_key(entry.citation_key)[1] == target_page:
                    return entry
        return matches[0] if matches else None

    def all_sources(self) -> list[SourceEntry]:
        return list(self._all)

    def clear(self) -> None:
        self._urls.clear()
        self._parsed_urls.clear()
        self._citation_keys.clear()
        self._by_name.clear()
        self._by_document.clear()
        self._all.clear()
