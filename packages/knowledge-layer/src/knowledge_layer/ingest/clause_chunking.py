from __future__ import annotations

import logging
import re
from collections import Counter
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from llama_index.core import Document

_HEADER_RE = re.compile(r"^Österreichisches Institut für Bautechnik\b")
_MONTH = r"(?:Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)"
_EDITION = rf"Ausgabe\s+{_MONTH}\s+\d{{4}}\b"
_FOOTER_RE = re.compile(rf"^.{{0,90}}?\b{_EDITION}(?:\s+Rev\.\s*[\d.]+)?(?:\s+Seite\s+\d+\s+von\s+\d+)?\s*$")
_FOOTER_LABEL_RE = re.compile(
    rf"^(?P<label>\S.{{0,88}}?)\s+{_EDITION}(?:\s+Rev\.\s*[\d.]+)?(?:\s+Seite\s+\d+\s+von\s+\d+)?\s*$"
)

_DOT_LEADER_RE = re.compile(r"\.{4,}")
_TOC_ENTRY_RE = re.compile(r"\.{4,}\s*\d+\s*$")
logger = logging.getLogger(__name__)

_TOC_MIN_DOT_LEADER_LINES = 3

_CLAUSE_RE = re.compile(r"^(\d+(?:\.\d+){0,3})\s+(\S.*)$")

_HYPHEN_BREAK_RE = re.compile(r"(\w)-\n([a-zäöüß])")

_END_OF_BODY_RE = re.compile(r"^Impressum\s*$")

_MIN_CLAUSES = 5
_MIN_CLAUSE_COVERAGE = 0.60

_MAX_ID_SEGMENT_DIGITS = 2

_MAX_ID_GAP = 2

_MAX_FIRST_ID = 1

CLAUSE_EMBED_EXCLUDED_METADATA_KEYS = ("page_end", "clause_depth", "chunking", "table_part")

_BREADCRUMB_SEP = " › "


def _is_furniture(line: str) -> bool:
    return bool(_HEADER_RE.match(line) or _FOOTER_RE.match(line))


def _is_toc_page(text: str) -> bool:
    return sum(1 for line in text.splitlines() if _TOC_ENTRY_RE.search(line)) >= _TOC_MIN_DOT_LEADER_LINES


def _parse_clause_id(raw: str) -> tuple[int, ...] | None:
    segments = raw.split(".")
    for segment in segments:
        if len(segment) > _MAX_ID_SEGMENT_DIGITS or (len(segment) > 1 and segment.startswith("0")):
            return None
    return tuple(int(segment) for segment in segments)


def _is_monotonic(candidate: tuple[int, ...], previous: tuple[int, ...] | None) -> bool:
    if previous is None:
        return len(candidate) == 1 and candidate[0] <= _MAX_FIRST_ID
    if len(candidate) > len(previous):
        return candidate[: len(previous)] == previous and set(candidate[len(previous) :]) == {1}
    level = len(candidate) - 1
    if candidate[:level] != previous[:level]:
        return False
    return 1 <= candidate[level] - previous[level] <= _MAX_ID_GAP


_MAX_CHAIN_CANDIDATES = 2000

_TITLE_MATCH_CHARS = 12


def _dehyphenate(text: str) -> str:
    return _HYPHEN_BREAK_RE.sub(r"\1\2", text)


def _document_label(lines: list[str]) -> str:
    labels: Counter[str] = Counter()
    for line in lines:
        match = _FOOTER_LABEL_RE.match(line)
        if match:
            labels[match.group("label").strip()] += 1
    return labels.most_common(1)[0][0] if labels else ""


def _document_subject(lines: list[str]) -> str:
    marker = re.compile(r"^(?:-|O\s?ia\b|Erläuternde\b|Bemerkungen\b)")
    for index, line in enumerate(lines):
        if not re.match(rf"^Ausgabe:\s*{_MONTH}\s*\d{{4}}\s*$", line):
            continue
        collected: list[str] = []
        for candidate in reversed(lines[max(0, index - 4) : index]):
            if marker.match(candidate):
                return " ".join(reversed(collected)).strip()
            collected.append(candidate.strip())
        return ""
    return ""


def _collect_lines(text_pages: list[dict[str, Any]]) -> list[tuple[int, str]]:
    collected: list[tuple[int, str]] = []
    for page in text_pages:
        text = page.get("text") or ""
        if _is_toc_page(text):
            continue
        try:
            page_number = int(page.get("page_number"))
        except TypeError, ValueError:
            page_number = 0
        for line in text.splitlines():
            stripped = line.strip()
            if stripped and not _is_furniture(stripped):
                collected.append((page_number, stripped))
    return collected


class _Segment:
    __slots__ = ("clause_id", "depth", "lines", "parent_id", "title")

    def __init__(self, clause_id: str, title: str, depth: int, parent_id: str) -> None:
        self.clause_id = clause_id
        self.title = title
        self.depth = depth
        self.parent_id = parent_id
        self.lines: list[tuple[int, str]] = []

    @property
    def text(self) -> str:
        return _dehyphenate("\n".join(line for _page, line in self.lines))

    @property
    def page_start(self) -> int:
        return self.lines[0][0]

    @property
    def page_end(self) -> int:
        return self.lines[-1][0]


def _heading_candidates(
    lines: list[tuple[int, str]],
    body_end: int,
    listed: dict[str, str],
) -> list[tuple[int, tuple[int, ...], re.Match[str]]]:
    candidates: list[tuple[int, tuple[int, ...], re.Match[str]]] = []
    for index in range(body_end):
        line = lines[index][1]
        match = _CLAUSE_RE.match(line)
        if match is None or _DOT_LEADER_RE.search(line):
            continue
        if _contradicts_contents(match, listed):
            continue
        parsed = _parse_clause_id(match.group(1))
        if parsed is not None:
            candidates.append((index, parsed, match))
    return candidates


def _title_key(title: str) -> str:
    return re.sub(r"\s+", " ", _DOT_LEADER_RE.split(title, maxsplit=1)[0]).strip().lower()[:_TITLE_MATCH_CHARS]


def _listed_headings(text_pages: list[dict[str, Any]]) -> dict[str, str]:
    listed: dict[str, str] = {}
    for page in text_pages:
        text = page.get("text") or ""
        if not _is_toc_page(text):
            continue
        for line in text.splitlines():
            stripped = line.strip()
            if not _TOC_ENTRY_RE.search(stripped):
                continue
            match = _CLAUSE_RE.match(stripped)
            if match is not None and _parse_clause_id(match.group(1)) is not None:
                listed.setdefault(match.group(1), _title_key(match.group(2)))
    return listed if len(listed) >= _MIN_CLAUSES else {}


def _contradicts_contents(match: re.Match[str], listed: dict[str, str]) -> bool:
    expected = listed.get(match.group(1))
    if expected is None:
        return False
    actual = _title_key(match.group(2))
    return not expected.startswith(actual) and not actual.startswith(expected)


def _best_chain(
    candidates: list[tuple[int, tuple[int, ...], re.Match[str]]],
    listed: dict[str, str],
) -> list[tuple[int, tuple[int, ...], re.Match[str]]]:
    if not candidates or len(candidates) > _MAX_CHAIN_CANDIDATES:
        return []
    score: list[tuple[int, int]] = [(0, 0)] * len(candidates)
    previous = [-1] * len(candidates)
    for position, (_index, ids, match) in enumerate(candidates):
        anchor = 1 if match.group(1) in listed else 0
        if _is_monotonic(ids, None):
            score[position] = (anchor, 1)
        for earlier in range(position):
            if score[earlier] == (0, 0):
                continue
            extended = (score[earlier][0] + anchor, score[earlier][1] + 1)
            if extended <= score[position]:
                continue
            if _is_monotonic(ids, candidates[earlier][1]):
                score[position] = extended
                previous[position] = earlier
    best = max(range(len(candidates)), key=lambda position: score[position])
    if score[best] == (0, 0):
        return []
    chain: list[tuple[int, tuple[int, ...], re.Match[str]]] = []
    cursor = best
    while cursor >= 0:
        chain.append(candidates[cursor])
        cursor = previous[cursor]
    chain.reverse()
    return chain


def _back_matter(text_pages: list[dict[str, Any]]) -> tuple[str, ...]:
    trailing: list[str] = []
    for page in text_pages:
        text = page.get("text") or ""
        if not _is_toc_page(text):
            continue
        entries: list[str] = []
        numbered_seen = False
        for line in (stripped for stripped in map(str.strip, text.splitlines()) if _TOC_ENTRY_RE.search(stripped)):
            match = _CLAUSE_RE.match(line)
            numbered = match is not None and _parse_clause_id(match.group(1)) is not None
            numbered_seen = numbered_seen or numbered
            entries = [] if numbered else [*entries, _title_key(line)]
        if numbered_seen:
            trailing = entries
    return tuple(key for key in trailing if key)


def _cut_back_matter(segments: list[_Segment], postamble: list[tuple[int, str]], keys: tuple[str, ...]) -> None:
    if not segments or not keys:
        return
    last = segments[-1].lines
    for index, (page, line) in enumerate(last[1:], start=1):
        key = _title_key(line)
        opens_page = page != last[index - 1][0]
        if _DOT_LEADER_RE.search(line) is None and (key in keys or (opens_page and _opens_with(key, keys))):
            postamble[:0] = last[index:]
            del last[index:]
            return


def _opens_with(key: str, keys: tuple[str, ...]) -> bool:
    return any(key == entry or key.startswith(entry + " ") for entry in keys)


def _split_into_segments(
    lines: list[tuple[int, str]],
    listed: dict[str, str] | None = None,
    back_matter: tuple[str, ...] = (),
) -> tuple[list[tuple[int, str]], list[_Segment], list[tuple[int, str]]]:
    body_end = len(lines)
    for index, (_page_number, line) in enumerate(lines):
        if _END_OF_BODY_RE.match(line):
            body_end = index
            break

    listed = listed or {}
    candidates = _heading_candidates(lines, body_end, listed)
    openings = {candidate[0]: candidate for candidate in _best_chain(candidates, listed)}

    preamble: list[tuple[int, str]] = []
    postamble: list[tuple[int, str]] = list(lines[body_end:])
    segments: list[_Segment] = []

    for index in range(body_end):
        page_number, line = lines[index]
        opening = openings.get(index)
        if opening is not None:
            _index, parsed, match = opening
            raw_id = match.group(1)
            parent_id = raw_id.rsplit(".", 1)[0] if "." in raw_id else ""
            segments.append(_Segment(raw_id, match.group(2).strip(), len(parsed), parent_id))
            segments[-1].lines.append((page_number, line))
        elif segments:
            segments[-1].lines.append((page_number, line))
        else:
            preamble.append((page_number, line))

    _cut_back_matter(segments, postamble, back_matter)
    return preamble, segments, postamble


def _breadcrumb_path(segments: list[_Segment], index: int) -> list[str]:
    path: list[str] = []
    depth = segments[index].depth
    for candidate in reversed(segments[:index]):
        if candidate.depth < depth:
            path.append(f"{candidate.clause_id} {candidate.title}")
            depth = candidate.depth
            if depth == 1:
                break
    path.reverse()
    return path


def _apply_exclusions(document: Any) -> None:
    try:
        from knowledge_layer.ingest.chunk_metadata import apply_metadata_exclusions

        apply_metadata_exclusions(document)
    except ImportError:  # pragma: no cover - the adapter is always present in practice
        logger.warning("Adapter metadata exclusions unavailable; applying Punkt exclusions only")
    for attribute in ("excluded_embed_metadata_keys", "excluded_llm_metadata_keys"):
        existing = list(getattr(document, attribute, None) or [])
        merged = existing + [key for key in CLAUSE_EMBED_EXCLUDED_METADATA_KEYS if key not in existing]
        setattr(document, attribute, merged)


def guideline_key(file_name: str) -> str:
    stem = file_name
    for suffix in (".pdf", ".PDF"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
    stem = re.sub(r"^(oib-rl|oib_rl|oib-richtlinie)[_-]", "", stem)
    stem = re.sub(r"[_-]ausgabe[_-][^_-]+[_-]\d{4}.*$", "", stem, flags=re.IGNORECASE)
    return stem.replace("_", "-") or file_name


_guideline_key = guideline_key


def clause_documents(text_pages: list[dict[str, Any]], file_name: str, file_size: int) -> list[Document] | None:
    from llama_index.core import Document

    if not text_pages:
        return None

    lines = _collect_lines(text_pages)
    if not lines:
        return None

    preamble, segments, postamble = _split_into_segments(lines, _listed_headings(text_pages), _back_matter(text_pages))
    if len(segments) < _MIN_CLAUSES:
        return None

    body_characters = sum(len(line) for _page, line in lines) - sum(len(line) for _page, line in postamble)
    clause_characters = sum(len(line) for segment in segments for _page, line in segment.lines)
    if not body_characters or clause_characters / body_characters < _MIN_CLAUSE_COVERAGE:
        return None

    raw_lines = [line.strip() for page in text_pages for line in (page.get("text") or "").splitlines() if line.strip()]
    label = _document_label(raw_lines)
    subject = _document_subject(raw_lines)
    heading = f"{label} — {subject}" if label and subject else (label or subject or file_name)
    guideline = guideline_key(file_name)

    documents: list[Document] = []
    base_metadata = {"file_name": file_name, "file_size": file_size}

    for page_number, page_lines in _group_by_page(preamble + postamble):
        documents.append(
            Document(
                text=_dehyphenate("\n".join(page_lines)),
                metadata={
                    **base_metadata,
                    "page_label": str(page_number),
                    "content_type": "text",
                    "chunking": "page",
                    "guideline": guideline,
                },
            )
        )

    for index, segment in enumerate(segments):
        path = _breadcrumb_path(segments, index)
        header = heading
        if path:
            header = f"{heading}\n{_BREADCRUMB_SEP.join(path)}"
        documents.append(
            Document(
                text=f"{header}\n\n{segment.text}",
                metadata={
                    **base_metadata,
                    "page_label": str(segment.page_start),
                    "page_end": str(segment.page_end),
                    "content_type": "text",
                    "chunking": "clause",
                    "clause_id": segment.clause_id,
                    "clause_path": _BREADCRUMB_SEP.join([*path, f"{segment.clause_id} {segment.title}"]),
                    "clause_parent_id": segment.parent_id,
                    "clause_title": segment.title,
                    "clause_depth": segment.depth,
                    "guideline": guideline,
                },
            )
        )

    documents.extend(_table_documents(text_pages, heading, base_metadata, guideline))

    for document in documents:
        _apply_exclusions(document)

    return documents


def _table_documents(
    text_pages: list[dict[str, Any]], heading: str, base_metadata: dict[str, Any], guideline: str
) -> list[Document]:
    from llama_index.core import Document

    from knowledge_layer.ingest.captioned_tables import join_fragments
    from knowledge_layer.ingest.captioned_tables import markdown_chunks

    fragments = [table for page in text_pages for table in page.get("tables") or []]
    documents: list[Document] = []
    for table in join_fragments(fragments):
        clause_id = f"Tabelle {table.table_id}"
        caption = f"{clause_id}: {table.title}" if table.title else clause_id
        chunks = markdown_chunks(table)
        for index, chunk in enumerate(chunks, start=1):
            part = f" (Teil {index} von {len(chunks)})" if len(chunks) > 1 else ""
            documents.append(
                Document(
                    text=f"{heading}\n{caption}{part}\n\n{chunk}",
                    metadata={
                        **base_metadata,
                        "page_label": str(table.page_start),
                        "page_end": str(table.page_end),
                        "content_type": "table",
                        "chunking": "table",
                        "clause_id": clause_id,
                        "clause_title": table.title,
                        "clause_path": caption,
                        "guideline": guideline,
                        "table_part": index,
                    },
                )
            )
    return documents


def _group_by_page(lines: list[tuple[int, str]]) -> list[tuple[int, list[str]]]:
    grouped: list[tuple[int, list[str]]] = []
    for page_number, line in lines:
        if grouped and grouped[-1][0] == page_number:
            grouped[-1][1].append(line)
        else:
            grouped.append((page_number, [line]))
    return grouped
