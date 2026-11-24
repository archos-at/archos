from __future__ import annotations

import logging
import math
import re

from agent.citations.entries import SourceEntry
from agent.citations.registry import MAX_REGIONS_PER_SOURCE
from agent.common.grounding_block import PROJECT_STATUS_LABELS
from agent.common.grounding_block import SourceRegion
from agent.common.passage_fence import fenced_spans
from agent.common.passage_fence import unfence
from agent.common.passage_fence import unfenced
from agent.common.source_kinds import parse_shelf

logger = logging.getLogger(__name__)


_KL_CITATION_RE = re.compile(r"^Citation:\s*(.+)$", re.MULTILINE)


_KL_SOURCE_RE = re.compile(r"^Source:\s*(.+)$", re.MULTILINE)


_KL_COLLECTION_RE = re.compile(r"^Collection:\s*(.+)$", re.MULTILINE)


_KL_SHELF_RE = re.compile(r"^Shelf:\s*(.+)$", re.MULTILINE)


_KL_DOC_CLASS_RE = re.compile(r"^(?:Dokumentart|Doc-Class):\s*(.+)$", re.MULTILINE)
_KL_FORMAT_RE = re.compile(r"^Format:\s*(.+)$", re.MULTILINE)


_KL_PROVENANCE_RE = re.compile(r"^Herkunft:\s*(.+)$", re.MULTILINE)


_KL_PROJECT_RE = re.compile(r"^Projekt:\s*(.+?)\s+—\s+(\S+)\s+\(project_id\s+([^\s)]+)\)\s*$", re.MULTILINE)


_KL_CLAUSE_RE = re.compile(r"^Punkt:\s*(.+?)\s*$", re.MULTILINE)


_KL_FEDERAL_STATE_RE = re.compile(r"^Bundesland:\s*(.+?)\s*$", re.MULTILINE)


_KL_SCORE_RE = re.compile(r"^Relevance Score:\s*(-?\d+(?:\.\d+)?)\s*$", re.MULTILINE)


_KL_RESULT_BLOCK_RE = re.compile(r"^--- Result \d+ ---[^\S\n]*$", re.MULTILINE)


_KL_RELEVANCE_LINE_RE = re.compile(r"^Relevance Score:.*$", re.MULTILINE)


_KL_TRACE_LANES_RE = re.compile(r"^## Trace-Lanes", re.MULTILINE)


_KL_TRUNCATED_SUFFIX_RE = re.compile(r"\s*\.\.\.\s*\[truncated\]\s*$")


def _split_kl_result_blocks(content: str) -> list[str]:
    markers = list(unfenced(_KL_RESULT_BLOCK_RE, content))
    if not markers:
        return []
    ends = [marker.start() for marker in markers[1:]] + [len(content)]
    blocks: list[str] = []
    for marker, end in zip(markers, ends, strict=True):
        lanes = next(unfenced(_KL_TRACE_LANES_RE, content[:end], marker.end()), None)
        blocks.append(content[marker.end() : lanes.start() if lanes else end])
    return blocks


def _kl_block_body(block: str) -> str:
    relevance_match = _KL_RELEVANCE_LINE_RE.search(block)
    if relevance_match is None:
        return ""
    rest = block[relevance_match.end() :].strip()
    spans = fenced_spans(rest)
    body = unfence(rest[: spans[0][1]] if spans and spans[0][0] == 0 else rest)
    return _KL_TRUNCATED_SUFFIX_RE.sub("", body.strip()).strip()


def _kl_block_header(block: str) -> str:
    relevance_match = _KL_RELEVANCE_LINE_RE.search(block)
    return block[: relevance_match.start()] if relevance_match else block


def _extract_kl_chunk_bodies(content: str) -> list[str]:
    return [_kl_block_body(block) for block in _split_kl_result_blocks(content)]


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(1).strip() or None if match else None


def _parse_kl_doc_class(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.split("—")[0].split(" - ")[0].strip() or None
    if not key:
        return None
    from agent.knowledge.document_classification import canonical_doc_class

    return canonical_doc_class(key) or key


def _parse_kl_source_format(raw: str | None) -> str | None:
    return (raw or "").split("—")[0].strip() or None


def _parse_kl_authored_by(raw: str | None) -> str | None:
    from agent.common.provenance import AGENT_AUTHOR
    from agent.common.source_kinds import AGENT_AUTHORED_LANE_LABEL

    value = (raw or "").strip()
    return AGENT_AUTHOR if value.startswith(AGENT_AUTHORED_LANE_LABEL) else None


def _kl_entry(
    *,
    citation_key: str,
    title: str | None,
    collection: str | None,
    shelf: str | None = None,
    doc_class: str | None,
    authored_by: str | None = None,
    source_format: str | None = None,
    chunk_text: str | None,
    tool_name: str,
    clause: str | None = None,
    score: float | None = None,
    project: tuple[str, str, str] | None = None,
    project_federal_state_note: str | None = None,
) -> SourceEntry:
    parsed_shelf = parse_shelf(shelf)
    project_name, status_label, project_id = project if project else (None, None, None)
    return SourceEntry(
        citation_key=citation_key.strip(),
        title=title,
        source_type="knowledge_layer",
        tool_name=tool_name,
        collection=collection or None,
        shelf=str(parsed_shelf) if parsed_shelf else None,
        doc_class=doc_class or None,
        authored_by=authored_by or None,
        source_format=source_format or None,
        chunk_text=chunk_text or None,
        clause=(clause or "").strip() or None,
        score=score,
        project_id=project_id,
        project_name=project_name,
        project_status=_PROJECT_STATUS_BY_LABEL.get(status_label, status_label) if status_label else None,
        project_federal_state_note=project_federal_state_note,
    )


_PROJECT_STATUS_BY_LABEL = {label: status for status, label in PROJECT_STATUS_LABELS.items()}


def _parse_kl_project(header: str) -> tuple[str, str, str] | None:
    match = _KL_PROJECT_RE.search(header)
    return (match.group(1).strip(), match.group(2), match.group(3)) if match else None


def _parse_kl_score(value: str | None) -> float | None:
    if not value:
        return None
    try:
        score = float(value)
    except ValueError:
        return None
    return score if math.isfinite(score) else None


def parse_knowledge_layer(content: str, tool_name: str) -> list[SourceEntry]:
    blocks = _split_kl_result_blocks(content)
    entries: list[SourceEntry] = []

    if blocks:
        for block in blocks:
            header = _kl_block_header(block)
            citation_key = _first(_KL_CITATION_RE, header)
            if not citation_key:
                continue
            entries.append(
                _kl_entry(
                    citation_key=citation_key,
                    title=_first(_KL_SOURCE_RE, header),
                    collection=_first(_KL_COLLECTION_RE, header),
                    shelf=_first(_KL_SHELF_RE, header),
                    doc_class=_parse_kl_doc_class(_first(_KL_DOC_CLASS_RE, header)),
                    authored_by=_parse_kl_authored_by(_first(_KL_PROVENANCE_RE, header)),
                    source_format=_parse_kl_source_format(_first(_KL_FORMAT_RE, header)),
                    chunk_text=_kl_block_body(block),
                    tool_name=tool_name,
                    clause=_first(_KL_CLAUSE_RE, header),
                    project=_parse_kl_project(header),
                    project_federal_state_note=_first(_KL_FEDERAL_STATE_RE, header),
                    score=_parse_kl_score(_first(_KL_SCORE_RE, block)),
                )
            )
    else:
        entries = _kl_positional_entries(content, tool_name)

    return entries


def _kl_positional_entries(content: str, tool_name: str) -> list[SourceEntry]:
    citations = _KL_CITATION_RE.findall(content)
    sources = _KL_SOURCE_RE.findall(content)
    collections = _KL_COLLECTION_RE.findall(content)
    doc_classes = _KL_DOC_CLASS_RE.findall(content)
    return [
        _kl_entry(
            citation_key=citation_key,
            title=sources[i].strip() if i < len(sources) else None,
            collection=collections[i].strip() if i < len(collections) else None,
            doc_class=_parse_kl_doc_class(doc_classes[i] if i < len(doc_classes) else None),
            chunk_text=None,
            tool_name=tool_name,
        )
        for i, citation_key in enumerate(citations)
    ]


_KL_REGION_RE = re.compile(r"^Region:\s*\[([^\]]+)\]\s*(?:„(.*?)“)?\s*$", re.MULTILINE)


def _regions_from_header(header: str) -> list[SourceRegion]:
    regions: list[SourceRegion] = []
    for match in _KL_REGION_RE.finditer(header):
        try:
            x, y, w, h = (float(part) for part in match.group(1).split(","))
        except ValueError:
            continue
        regions.append(SourceRegion(box=(x, y, round(x + w, 4), round(y + h, 4)), label=match.group(2) or None))
    return regions[:MAX_REGIONS_PER_SOURCE]


def parse_look(content: str, tool_name: str) -> list[SourceEntry]:
    entries: list[SourceEntry] = []
    for block in _split_kl_result_blocks(content):
        header = _kl_block_header(block)
        citation_key = _first(_KL_CITATION_RE, header)
        if not citation_key:
            continue
        entry = _kl_entry(
            citation_key=citation_key,
            title=_first(_KL_SOURCE_RE, header),
            collection=_first(_KL_COLLECTION_RE, header),
            shelf=_first(_KL_SHELF_RE, header),
            doc_class=None,
            chunk_text=None,
            tool_name=tool_name,
        )
        entry.read = _kl_block_body(block) or None
        entry.regions = _regions_from_header(header)
        entries.append(entry)
    return entries
