from __future__ import annotations

import contextvars
import dataclasses
import logging
import os
import threading
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.citations.registry import SourceRegistry
from agent.common.grounding_block import SourceRegion

logger = logging.getLogger(__name__)


_session_source_registry: contextvars.ContextVar[SourceRegistry | None] = contextvars.ContextVar(
    "_session_source_registry", default=None
)


_MAX_SESSION_REGISTRIES = 1000


_session_registries: OrderedDict[str, SourceRegistry] = OrderedDict()


_session_registries_lock = threading.Lock()


_REGISTRY_CACHE_PREFIX = "citations:"


_REGISTRY_CACHE_TTL_SECONDS = int(os.environ.get("CITATION_REGISTRY_TTL_SECONDS", "86400"))


def _registry_from_cached_entries(entries: Any) -> SourceRegistry:
    registry = SourceRegistry()
    if isinstance(entries, list):
        for item in entries:
            if isinstance(item, dict):
                try:
                    registry.add(
                        SourceEntry(
                            url=item.get("url"),
                            title=item.get("title"),
                            citation_key=item.get("citation_key"),
                            source_type=item.get("source_type", ""),
                            tool_name=item.get("tool_name", ""),
                            collection=item.get("collection"),
                            shelf=item.get("shelf"),
                            doc_class=item.get("doc_class"),
                            authored_by=item.get("authored_by"),
                            source_format=item.get("source_format"),
                            chunk_text=item.get("chunk_text"),
                            clause=item.get("clause", item.get("punkt")),
                            score=item.get("score"),
                            regions=[
                                region
                                for region in map(SourceRegion.from_cached, item.get("regions") or [])
                                if region is not None
                            ],
                            read=item.get("read"),
                            page_end=item.get("page_end"),
                            project_id=item.get("project_id"),
                            project_name=item.get("project_name"),
                            project_status=item.get("project_status"),
                            project_federal_state_note=item.get("project_federal_state_note"),
                            work_id=item.get("work_id"),
                            edition_id=item.get("edition_id"),
                            public_url=item.get("public_url"),
                            retrieved_at=item.get("retrieved_at"),
                            revision_index=item.get("revision_index"),
                            revision_date=item.get("revision_date"),
                        )
                    )
                except Exception:
                    logger.debug("Skipping malformed cached source entry", exc_info=True)
    return registry


def persist_session_registry(session_id: str | None) -> None:
    if not session_id:
        return
    with _session_registries_lock:
        registry = _session_registries.get(session_id)
    if registry is None or not registry._all:
        return
    from agent.common import cache

    cache.set_json(
        f"{_REGISTRY_CACHE_PREFIX}{session_id}",
        [dataclasses.asdict(entry) for entry in registry._all],
        _REGISTRY_CACHE_TTL_SECONDS,
    )


def get_or_create_session_registry(session_id: str | None) -> SourceRegistry:
    if session_id is None:
        return SourceRegistry()
    from agent.common.profiler import annotate_current_span

    with _session_registries_lock:
        if session_id in _session_registries:
            _session_registries.move_to_end(session_id)
            annotate_current_span(cache_citation_registry="hit")
            return _session_registries[session_id]

    from agent.common import cache

    hydrated: SourceRegistry | None = None
    try:
        entries = cache.get_json(f"{_REGISTRY_CACHE_PREFIX}{session_id}")
        if entries:
            hydrated = _registry_from_cached_entries(entries)
    except Exception:
        logger.debug("Citation registry hydration failed for %s", session_id, exc_info=True)
    annotate_current_span(cache_citation_registry="hit-shared" if hydrated is not None else "miss")

    with _session_registries_lock:
        if session_id in _session_registries:
            _session_registries.move_to_end(session_id)
            return _session_registries[session_id]
        registry = hydrated if hydrated is not None else SourceRegistry()
        _session_registries[session_id] = registry
        while len(_session_registries) > _MAX_SESSION_REGISTRIES:
            _session_registries.popitem(last=False)
        return registry


_turn_captured_sources: contextvars.ContextVar[list[SourceEntry] | None] = contextvars.ContextVar(
    "_turn_captured_sources", default=None
)


def begin_turn_capture() -> contextvars.Token:
    return _turn_captured_sources.set([])


def end_turn_capture(token: contextvars.Token) -> None:
    _turn_captured_sources.reset(token)


def record_turn_capture(entries: Sequence[SourceEntry]) -> None:
    log = _turn_captured_sources.get()
    if log is not None:
        log.extend(entries)


def get_turn_captures() -> list[SourceEntry]:
    log = _turn_captured_sources.get()
    if not log:
        return []
    seen: set[str] = set()
    unique: list[SourceEntry] = []
    for entry in log:
        identity = normalize_url(entry.url) if entry.url else (entry.citation_key or "").lower()
        if not identity or identity in seen:
            continue
        seen.add(identity)
        unique.append(entry)
    return unique


def set_session_registry(registry: SourceRegistry | None) -> contextvars.Token:
    return _session_source_registry.set(registry)


def reset_session_registry(token: contextvars.Token) -> None:
    _session_source_registry.reset(token)


def get_session_registry() -> SourceRegistry | None:
    return _session_source_registry.get()
