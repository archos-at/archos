from __future__ import annotations

import logging
from typing import Any

from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.entries import is_look_place
from agent.citations.office_lines import office_line_fields
from agent.citations.roles import classification_for
from agent.citations.roles import role_fields
from agent.citations.roles import use_for_entry
from agent.citations.source_identity import document_key
from agent.citations.source_identity import source_lane
from agent.citations.source_identity import source_origin_token
from agent.common.knowledge_context import EditionUse
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import kind_for_lane

logger = logging.getLogger(__name__)


def source_entry_to_wire(entry: SourceEntry, *, number: int | None = None) -> dict[str, Any]:
    origin_token = source_origin_token(entry)
    origin = origin_token.strip("[]").lower() if origin_token else None

    file_name: str | None = None
    page: int | None = None
    if entry.citation_key:
        parsed_name, page = parse_citation_key(entry.citation_key)
        project_qualifier = f" ({entry.project_name})" if entry.project_name else None
        if project_qualifier and parsed_name.endswith(project_qualifier):
            parsed_name = parsed_name[: -len(project_qualifier)].rstrip()
        if parsed_name and "." in parsed_name.rsplit("/", 1)[-1]:
            file_name = parsed_name

    label = entry.citation_key or entry.title or entry.url or entry.tool_name or ""
    content = f"{origin_token} {label}".strip() if origin_token else label

    place = is_look_place(entry)
    lane_key, lane_label = source_lane(entry)
    if place:
        office = entry_shelf(entry) == Shelf.OFFICE_SHELF
        lane_key, lane_label = ("office", "Büroablage") if office else ("project", "Projektwissen")
    kind = kind_for_lane(lane_key)

    use = None if place else use_for_entry(entry)
    classification = classification_for(use, place=place)

    payload: dict[str, Any] = {
        "number": number,
        "document_id": document_key(entry),
        "content": content,
        "title": entry.title or file_name,
        "citation_key": entry.citation_key,
        "collection": entry.collection,
        "shelf": entry.shelf,
        "source_type": entry.source_type or None,
        "tool": entry.tool_name or None,
        "url": entry.url,
        "origin": origin,
        "kind": kind,
        "lane": lane_key,
        "lane_label": lane_label,
        "binding_status": classification.binding_status,
        **_line_fields(entry, use),
        "file_name": file_name,
        "page": page,
        "clause": entry.clause,
        "score": entry.score,
        "snippet": _wire_snippet(entry.chunk_text or entry.read),
        "regions": [region.to_wire() for region in entry.regions] or None,
        "page_end": entry.page_end,
        "project": _wire_project(entry),
    }
    return {key: value for key, value in payload.items() if value is not None}


def _line_fields(entry: SourceEntry, use: EditionUse | None) -> dict[str, Any]:
    return {
        **(role_fields(use) or office_line_fields(entry)),
        "public_url": entry.public_url or (use.source_url if use else None),
        "retrieved_at": entry.retrieved_at,
        "revision": _wire_revision(entry),
    }


def _wire_revision(entry: SourceEntry) -> dict[str, str] | None:
    revision = {"index": entry.revision_index, "date": entry.revision_date}
    return {key: value for key, value in revision.items() if value} or None


def _wire_project(entry: SourceEntry) -> dict[str, str] | None:
    if not entry.project_id:
        return None
    project = {"id": entry.project_id, "name": entry.project_name or "", "status": entry.project_status or "active"}
    if entry.project_federal_state_note:
        project["federalStateNote"] = entry.project_federal_state_note
    return project


_READ_SOURCE_WIRE_KEYS = frozenset(
    {
        "document_id",
        "citation_key",
        "file_name",
        "page",
        "collection",
        "shelf",
        "kind",
        "lane",
        "lane_label",
        "title",
        "url",
        "project",
    }
)


def read_source_to_wire(entry: SourceEntry) -> dict[str, Any]:
    return {key: value for key, value in source_entry_to_wire(entry).items() if key in _READ_SOURCE_WIRE_KEYS}


_WIRE_SNIPPET_MAX_CHARS = 1200


def _wire_snippet(chunk_text: str | None) -> str | None:
    text = (chunk_text or "").strip()
    if not text:
        return None
    if len(text) <= _WIRE_SNIPPET_MAX_CHARS:
        return text
    clipped = text[:_WIRE_SNIPPET_MAX_CHARS]
    boundary = clipped.rfind(" ")
    return clipped[:boundary] if boundary > _WIRE_SNIPPET_MAX_CHARS // 2 else clipped
