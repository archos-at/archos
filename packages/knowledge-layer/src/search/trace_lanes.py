import logging
from contextlib import nullcontext

from knowledge_layer.search.grounding_hits import grounding_hit
from knowledge_layer.search.hit_metadata import resolve_display_titles
from knowledge_layer.search.hit_metadata import resolve_doc_classes

from agent.common.wire_v2 import TraceLane
from agent.common.wire_v2 import TraceLaneSource

logger = logging.getLogger(__name__)


def _trace_lanes_for_chunks(
    chunks,
    resolved: dict[tuple[str, str], str] | None = None,
    resolved_titles: dict[tuple[str, str], str] | None = None,
) -> tuple[TraceLane, ...]:
    if resolved is None:
        resolved = resolve_doc_classes(chunks)
    if resolved_titles is None:
        resolved_titles = resolve_display_titles(chunks)
    hits = [
        grounding_hit(
            chunk,
            resolved=resolved,
            resolved_titles=resolved_titles,
            resolved_folders={},
            ambiguous=set(),
        )
        for chunk in chunks
    ]
    return trace_lanes_for_hits(hits)


def trace_lanes_for_hits(hits, opened_files: frozenset[str] = frozenset()) -> tuple[TraceLane, ...]:
    from agent.common.norm_registry import lane_for_knowledge_hit
    from agent.common.source_kinds import kind_for_lane

    lanes: dict[str, tuple[str, list]] = {}
    for hit in hits:
        key, label = lane_for_knowledge_hit(
            doc_class=hit.doc_class,
            file_name=hit.file_name,
            collection=hit.collection,
            shelf=hit.shelf,
            authored_by=hit.authored_by,
            source_format=hit.source_format,
        )
        lanes.setdefault(key, (label, []))[1].append(hit)
    return tuple(
        TraceLane(
            key=key,
            label=label,
            kind=kind_for_lane(key),
            hit_count=len(members),
            sources=_lane_sources(members, opened_files),
        )
        for key, (label, members) in lanes.items()
    )


def _lane_detail(hit) -> str | None:
    page = f"p.{hit.page}" if hit.page is not None else ""
    if not hit.clause:
        return page or None
    return f"Pkt. {hit.clause} {page}".strip()


def _lane_sources(hits, opened_files: frozenset[str]) -> list[TraceLaneSource]:
    sources: list[TraceLaneSource] = []
    seen: set[tuple[str, str]] = set()
    for hit in hits:
        detail = _lane_detail(hit)
        if not hit.file_name or (hit.file_name, detail or "") in seen:
            continue
        seen.add((hit.file_name, detail or ""))
        sources.append(_lane_source(hit, detail, opened=hit.file_name in opened_files))
    return sources


def _lane_source(hit, detail: str | None, *, opened: bool) -> TraceLaneSource:
    from agent.common.provenance import provenance_metadata
    from agent.common.tool_calls import READ_PASSAGE_TOOL
    from agent.common.turn_status import current_retrieval_round
    from agent.common.turn_status import lane_tool_scope
    from agent.common.turn_status import record_lane_hit

    source = TraceLaneSource(
        name=hit.file_name,
        title=hit.display_title if hit.display_title and hit.display_title != hit.file_name else None,
        detail=detail,
        shelf=str(hit.shelf) if hit.shelf is not None else None,
        round=current_retrieval_round(),
        provenance=provenance_metadata(hit.provenance) if hit.provenance is not None else None,
    )
    with lane_tool_scope(READ_PASSAGE_TOOL) if opened else nullcontext():
        record_lane_hit(source.name, title=source.title, detail=source.detail, shelf=source.shelf)
    return source


trace_lanes_for_chunks = _trace_lanes_for_chunks
