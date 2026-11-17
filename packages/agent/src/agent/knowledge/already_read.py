from __future__ import annotations

import logging
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

logger = logging.getLogger(__name__)

DIGEST_HEADING = "## Bereits gelesen (diese Unterhaltung)"

MAX_DIGEST_DOCS = 20

MAX_DIGEST_TOKENS = 800

MAX_DIGEST_PAGE_RUN = 500


@dataclass
class DigestEntry:

    file_name: str
    collection: str
    pages: set[int] = field(default_factory=set)
    clauses: set[str] = field(default_factory=set)
    turn: int = 1


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _clause_sort_key(raw: str) -> tuple:
    try:
        numbered = tuple(int(part) for part in raw.split(".")) if raw else ()
    except ValueError:
        numbered = ()
    return (numbered, raw)


def _page_runs(pages: Sequence[int]) -> str:
    parts: list[str] = []
    ordered = sorted(pages)
    index = 0
    while index < len(ordered):
        end = index
        while end + 1 < len(ordered) and ordered[end + 1] == ordered[end] + 1:
            end += 1
        if end - index >= 2:
            parts.append(f"{ordered[index]}-{ordered[end]}")
        else:
            parts.extend(str(page) for page in ordered[index : end + 1])
        index = end + 1
    return ", ".join(parts)


def _parse_page_token(token: str) -> set[int]:
    first, dash, last = token.strip().partition("-")
    start, end = int(first), int(last) if dash else int(first)
    if end < start or end - start > MAX_DIGEST_PAGE_RUN:
        raise ValueError(token)
    return set(range(start, end + 1))


def format_digest_line(
    file_name: str, collection: str, pages: set[int] | Sequence[int], clauses: set[str] | Sequence[str], turn: int
) -> str:
    ordered_pages = sorted({int(page) for page in pages})
    ordered_clauses = sorted({str(clause) for clause in clauses if str(clause).strip()}, key=_clause_sort_key)
    pages_bit = _page_runs(ordered_pages) if ordered_pages else "-"
    clauses_bit = ", ".join(ordered_clauses) if ordered_clauses else "-"
    return f"{file_name} | {collection} | Seiten {pages_bit} | Punkte {clauses_bit} | Turn {max(1, int(turn))}"


def parse_digest_line(line: str) -> DigestEntry | None:
    parts = [part.strip() for part in str(line or "").split(" | ")]
    if len(parts) != 5:
        return None
    file_name, collection, pages_part, clauses_part, turn_bit = parts
    if (
        not file_name
        or not collection
        or not pages_part.startswith("Seiten ")
        or not clauses_part.startswith("Punkte ")
    ):
        return None
    if not turn_bit.startswith("Turn "):
        return None
    try:
        turn = max(1, int(turn_bit[len("Turn ") :].strip()))
    except ValueError:
        return None
    pages: set[int] = set()
    raw_pages = pages_part[len("Seiten ") :].strip()
    if raw_pages and raw_pages != "-":
        for token in raw_pages.split(","):
            try:
                pages |= _parse_page_token(token)
            except ValueError:
                return None
    clauses: set[str] = set()
    raw_clauses = clauses_part[len("Punkte ") :].strip()
    if raw_clauses and raw_clauses != "-":
        clauses = {token.strip() for token in raw_clauses.split(",") if token.strip()}
        if not clauses:
            return None
    return DigestEntry(file_name=file_name, collection=collection, pages=pages, clauses=clauses, turn=turn)


def _capture_identity(entry: Any) -> tuple[str, str, str, str] | None:
    from agent.citations.citation_keys import parse_citation_key

    citation_key = getattr(entry, "citation_key", None) or ""
    if not citation_key:
        return None
    file_name, _page = parse_citation_key(citation_key)
    file_name = (file_name or "").strip()
    if not file_name or "." not in file_name.rsplit("/", 1)[-1]:
        return None
    collection = str(getattr(entry, "collection", None) or "").strip() or "-"
    return (f"{collection.casefold()}\x1f{file_name.casefold()}", file_name, collection, citation_key)


def _capture_page(entry: Any) -> int | None:
    from agent.citations.citation_keys import parse_citation_key

    _file_name, page = parse_citation_key(getattr(entry, "citation_key", None) or "")
    return page


def _capture_clause(entry: Any) -> str | None:
    clause = str(getattr(entry, "clause", None) or "").strip()
    return clause or None


def merge_digest(previous: Sequence[str] | None, captures: Sequence[Any], turn: int) -> list[str] | None:
    current = max(1, int(turn))
    merged: OrderedDict[str, DigestEntry] = OrderedDict()
    for line in previous or ():
        parsed = parse_digest_line(line)
        if parsed is None:
            continue
        key = f"{parsed.collection.casefold()}\x1f{parsed.file_name.casefold()}"
        known = merged.get(key)
        if known is None:
            merged[key] = parsed
        else:
            known.pages |= parsed.pages
            known.clauses |= parsed.clauses
            known.turn = max(known.turn, parsed.turn)
    for entry in captures or ():
        identity = _capture_identity(entry)
        if identity is None:
            continue
        key, file_name, collection, _citation_key = identity
        page = _capture_page(entry)
        clause = _capture_clause(entry)
        known = merged.get(key)
        if known is None:
            merged[key] = DigestEntry(
                file_name=file_name,
                collection=collection,
                pages={page} if page is not None else set(),
                clauses={clause} if clause else set(),
                turn=current,
            )
        else:
            if page is not None:
                known.pages.add(page)
            if clause:
                known.clauses.add(clause)
            known.turn = current
            merged.move_to_end(key)
    lines = [
        format_digest_line(item.file_name, item.collection, item.pages, item.clauses, item.turn)
        for item in merged.values()
    ]
    while len(lines) > MAX_DIGEST_DOCS:
        lines.pop(0)
    while len(lines) > 1 and sum(estimate_tokens(line) for line in lines) > MAX_DIGEST_TOKENS:
        lines.pop(0)
    return lines or None


def render_already_read_block(digest: Sequence[str] | None) -> str:
    lines = [line.strip() for line in (digest or []) if line and line.strip()]
    if not lines:
        return ""
    return "\n".join(
        [
            DIGEST_HEADING,
            "Documents already opened in THIS conversation — an index, NOT evidence: "
            "a line proves that the document was opened, not that its wording is available now "
            "(the passages of the PREVIOUS turn are still in the transcript; older ones are not). "
            "Cite or quote verbatim only after opening it again by the exact name from the line; "
            "the digest line itself is never cited.",
            f"Limited to at most {MAX_DIGEST_DOCS} documents / about {MAX_DIGEST_TOKENS} tokens — "
            "older entries drop out; what is missing here is therefore not ruled out, but is to be "
            "searched with `knowledge_search`. Entries can be outdated (a newer Fassung was filed): "
            "if the read finds no such document or passage, resolve again with `knowledge_search`.",
            *[f"- {line}" for line in lines],
        ]
    )
