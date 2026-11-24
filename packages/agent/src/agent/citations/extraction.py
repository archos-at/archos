from __future__ import annotations

import logging
import re
from html import unescape
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.entries import is_look_tool
from agent.citations.entries import normalize_url
from agent.citations.registry import MAX_REGIONS_PER_SOURCE
from agent.citations.text_parsers import parser_for
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import get_grounding_block
from agent.common.licensed_text import quotable
from agent.common.source_kinds import TOOL_RESULT_SOURCE_TYPE

logger = logging.getLogger(__name__)


def extract_sources_from_tool_result(
    tool_name: str,
    content: str,
    source_id: str | None = None,
    artifact: Any = None,
) -> list[SourceEntry]:
    from agent.common.citation_collector import hits_from_artifact

    carried = hits_from_artifact(artifact)
    if carried is not None:
        return [_entry_from_hit(hit, tool_name) for hit in carried]

    block = get_grounding_block(content)
    if block is not None:
        return [_entry_from_hit(hit, tool_name) for hit in block.hits]

    if _is_non_citable_status_output(content):
        return []

    parser_fn = parser_for(tool_name)
    if parser_fn is not None:
        try:
            return parser_fn(content, tool_name)
        except Exception:
            logger.warning("Parser failed for tool %s, falling back to generic", tool_name, exc_info=True)
    entries = _parse_generic_urls(content, tool_name)
    if entries:
        return entries

    if content.strip():
        return [SourceEntry(citation_key=tool_name, source_type=TOOL_RESULT_SOURCE_TYPE, tool_name=tool_name)]

    return []


_BATCH_SECTION_SEPARATOR_RE = re.compile(r"\n\s*---\s*\n")


_BATCH_QUERY_HEADING_RE = re.compile(r"\A\s*##\s*Query:[^\n]*\n?", re.IGNORECASE)


def _split_batch_output_bodies(content: str) -> list[str] | None:
    sections = _BATCH_SECTION_SEPARATOR_RE.split(content.strip())
    bodies: list[str] = []
    for section in sections:
        heading_match = _BATCH_QUERY_HEADING_RE.match(section)
        if heading_match is None:
            return None
        bodies.append(section[heading_match.end() :])
    return bodies or None


def _is_non_citable_status_output(content: str) -> bool:
    batch_bodies = _split_batch_output_bodies(content)
    if batch_bodies is not None:
        return all(not body.strip() or _is_status_message(body) for body in batch_bodies)
    return _is_status_message(content)


def _is_status_message(content: str) -> bool:
    stripped = content.strip()
    normalized = re.sub(r"\s+", " ", stripped).rstrip(".").lower()
    if not normalized:
        return False
    if normalized.startswith("error:"):
        return True
    if normalized == "search returned no results" or normalized.endswith(" search returned no results"):
        return True
    is_terse_status_line = "\n" not in stripped and len(normalized) <= 300
    return is_terse_status_line and normalized.startswith(
        (
            "no ris documents found",
            "no documents found",
            "no results found",
        )
    )


def _look_entry(hit: GroundingHit, tool_name: str) -> SourceEntry:
    entry = _entry_from_hit_fields(hit, tool_name)
    entry.read = hit.body.strip() or None
    entry.chunk_text = None
    entry.score = None
    return entry


def _entry_from_hit(hit: GroundingHit, tool_name: str) -> SourceEntry:
    if is_look_tool(tool_name):
        return _look_entry(hit, tool_name)
    return _entry_from_hit_fields(hit, tool_name)


def _keep_licensed_text(hit: GroundingHit) -> None:
    from agent.citations.session import get_session_registry

    registry = get_session_registry()
    if registry is not None and hit.licence is not None and hit.licence.licensed and hit.licence.ai_processing:
        registry.keep_licensed_text(hit.citation_key.strip(), hit.body.strip())


def _entry_from_hit_fields(hit: GroundingHit, tool_name: str) -> SourceEntry:
    _keep_licensed_text(hit)
    return SourceEntry(
        citation_key=hit.citation_key.strip(),
        title=hit.display_title.strip() or None,
        source_type="knowledge_layer",
        tool_name=tool_name,
        collection=(hit.collection or "").strip() or None,
        shelf=str(hit.shelf) if hit.shelf is not None else None,
        doc_class=(hit.doc_class or "").strip() or None,
        authored_by=hit.authored_by,
        source_format=(hit.source_format or "").strip() or None,
        chunk_text=quotable(hit.body.strip(), hit.licence),
        clause=(hit.clause or "").strip() or None,
        score=hit.score,
        regions=list(hit.regions[:MAX_REGIONS_PER_SOURCE]),
        page_end=hit.page_end if hit.page_end and hit.page and hit.page_end > hit.page else None,
        project_id=hit.project.id if hit.project else None,
        project_name=hit.project.name if hit.project else None,
        project_status=hit.project.status if hit.project else None,
        project_federal_state_note=hit.project.federal_state_note if hit.project else None,
        work_id=(hit.work_id or "").strip() or None,
        edition_id=(hit.edition_id or "").strip() or None,
        public_url=(hit.public_url or "").strip() or None,
        revision_index=hit.revision.index if hit.revision else None,
        revision_date=hit.revision.date if hit.revision else None,
    )


_GENERIC_URL_RE = re.compile(r"https?://[^\s<>\"'\]]+")


URL_TRIM_CHARS = ".,;)]>"


_TITLE_NEAR_URL_PATTERNS = [
    re.compile(r"<title>\s*\n?(.*?)\n?\s*</title>", re.DOTALL | re.IGNORECASE),
    re.compile(r"^\d+\.\s+\*\*(.+?)\*\*", re.MULTILINE),
    re.compile(r"^---\s+(.+?)\s+---$", re.MULTILINE),
    re.compile(r"^Title:\s*(.+)$", re.MULTILINE),
]


def _extract_title_for_url(content: str, url: str, blocks: list[str] | None = None) -> str | None:
    if blocks is None:
        blocks = re.split(r"\n\n---\n\n|\n\n\n", content)
    for block in blocks:
        if url not in block:
            continue
        url_pos = block.index(url)
        best_title: str | None = None
        best_distance = float("inf")
        for pattern in _TITLE_NEAR_URL_PATTERNS:
            for title_match in pattern.finditer(block):
                title = title_match.group(1).strip()
                if not title or title == url:
                    continue
                distance = url_pos - title_match.end()
                if distance < 0:
                    distance = abs(distance) + 10000
                if distance < best_distance:
                    best_distance = distance
                    best_title = title
        if best_title:
            return best_title
    return None


def _parse_generic_urls(content: str, tool_name: str) -> list[SourceEntry]:
    seen: set[str] = set()
    entries: list[SourceEntry] = []
    blocks = re.split(r"\n\n---\n\n|\n\n\n", content)
    for match in _GENERIC_URL_RE.finditer(content):
        url = unescape(match.group(0)).rstrip(URL_TRIM_CHARS)
        normalized = normalize_url(url)
        if normalized not in seen:
            seen.add(normalized)
            title = _extract_title_for_url(content, url, blocks)
            entries.append(SourceEntry(url=url, title=title, source_type="generic", tool_name=tool_name))
    return entries
