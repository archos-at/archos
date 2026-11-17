from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from agent.citations.entries import SourceEntry
from agent.common.source_kinds import READABLE_QUALIFIERS
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import legacy_shelf_for_collection_name
from agent.common.source_kinds import parse_shelf
from agent.common.source_kinds import shelf_for_qualifier

logger = logging.getLogger(__name__)


PAGE_RE = re.compile(r"[,\s]\s*(?:p\.?|page)\s*(\d+)(?=\s*(?:[,)\]]|$))", re.IGNORECASE)


_SCOPE_QUALIFIER_ALTERNATION = "|".join(re.escape(label) for label in READABLE_QUALIFIERS)


_SCOPE_QUALIFIER_RE = re.compile(rf"\s*\(({_SCOPE_QUALIFIER_ALTERNATION})\)\s*$", re.IGNORECASE)


SCOPE_QUALIFIER_TOKEN_RE = re.compile(rf"\s*\(({_SCOPE_QUALIFIER_ALTERNATION})\)", re.IGNORECASE)


def parse_citation_ref(key: str) -> tuple[str, Shelf | None, int | None]:
    page_match = PAGE_RE.search(key)
    page = int(page_match.group(1)) if page_match else None
    if page_match:
        filename = key[: page_match.start()].rstrip(", ").strip()
    else:
        filename = key.strip()
    shelf = None
    qualifier_match = _SCOPE_QUALIFIER_RE.search(filename)
    if qualifier_match:
        shelf = shelf_for_qualifier(qualifier_match.group(1))
        filename = filename[: qualifier_match.start()].rstrip(", ").strip()
    from_path = citation_key_of_path(filename)
    if from_path is not None:
        filename, path_shelf = from_path[0][0], from_path[1]
        shelf = shelf or path_shelf
    return filename, shelf, page


def key_file_names(key: str, filename: str) -> list[str]:
    from_path = citation_key_of_path(path_in_citation(key) or "")
    return from_path[0] if from_path is not None else [filename]


_ESTATE_PATH_START_RE = re.compile(r"/(?:project|office|chat|law/oib)/")


_ESTATE_PATH_LEAF_RE = re.compile(
    r"[^\n]*?(?:\.(?:pdf|md|txt|csv|docx?|xlsx?|pptx?|ifc|dwg|dxf|png|jpe?g|tiff?|eml|msg|html?))+(?=[\s,;)\]]|$)",
    re.IGNORECASE,
)


def path_in_citation(text: str) -> str | None:
    start = _ESTATE_PATH_START_RE.search(text)
    if start is None:
        return None
    rest = text[start.start() :].split("\n", 1)[0]
    if leaf := _ESTATE_PATH_LEAF_RE.match(rest):
        return leaf.group(0)
    page = TITLE_PAGE_RE.search(rest)
    span = (rest[: page.start()] if page else rest).rstrip().rstrip(",").rstrip()
    qualifier = _SCOPE_QUALIFIER_RE.search(span)
    return (span[: qualifier.start()] if qualifier else span).rstrip() or None


def citation_key_of_path(text: str) -> tuple[list[str], Shelf | None] | None:
    from agent.common.estate_paths import MOUNT_SHELVES
    from agent.common.estate_paths import file_name_candidates
    from agent.common.estate_paths import mount_of_path

    candidate = text.strip()
    if not candidate.startswith("/"):
        return None
    mount = mount_of_path(candidate)
    if mount not in MOUNT_SHELVES:
        return None
    leaf = candidate.rstrip("/").rsplit("/", 1)[-1]
    if not leaf or candidate.endswith("/"):
        return None
    return file_name_candidates(leaf), parse_shelf(MOUNT_SHELVES[mount])


def entry_shelf(entry: SourceEntry) -> Shelf | None:
    return parse_shelf(entry.shelf) or legacy_shelf_for_collection_name(entry.collection)


def parse_citation_key(key: str) -> tuple[str, int | None]:
    filename, _scope, page = parse_citation_ref(key)
    return filename, page


@dataclass
class ParsedURL:

    host: str
    path: str
    path_segments: list[str]
    query: dict[str, list[str]]
    entry: SourceEntry


TITLE_PAGE_RE = re.compile(r"[,\s]\s*(?:S\.|p\.?|page)\s*(\d+)(?=\s*(?:[,)\]]|$))", re.IGNORECASE)
