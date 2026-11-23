from __future__ import annotations

import asyncio
import logging

from agent.cards.surface_ranking import SurfaceMode
from agent.cards.surface_ranking import _aggregate_surfaced
from agent.cards.surface_targets import _source_for_target

logger = logging.getLogger(__name__)


async def _surface_named(
    file_name: str,
    targets: list[str],
    meta: dict[str, dict],
    retrieve_query: str,
    chunk_top_k: int,
) -> list[dict]:
    info = meta.get(file_name) or {}
    source = "project"
    hits = await _retrieve_all(targets, retrieve_query, chunk_top_k)
    for chunk, src in hits:
        if getattr(chunk, "file_name", None) == file_name:
            source = src
            break
    snippet = None
    page = None
    score = 1.0
    for chunk, src in hits:
        if getattr(chunk, "file_name", None) != file_name:
            continue
        snippet = (getattr(chunk, "content", "") or "").strip() or None
        if snippet and len(snippet) > 300:
            snippet = snippet[:300].rstrip() + "…"
        page = getattr(chunk, "page_number", None)
        score = round(float(getattr(chunk, "score", 0.0) or 0.0), 4)
        source = src
        break
    return [
        {
            "file_name": file_name,
            "snippet": snippet,
            "page": page,
            "score": score if score else 1.0,
            "source": source,
            "summary": info.get("summary"),
            "_folder_path": info.get("folder_path") or None,
        }
    ]


async def _surface_search(
    query: str,
    targets: list[str],
    mode: SurfaceMode,
    chunk_top_k: int,
    max_files: int,
) -> list[dict]:
    hits = await _retrieve_all(targets, query, chunk_top_k)
    return _aggregate_surfaced(hits, max_files, mode, query)


async def _retrieve_all(
    targets: list[str],
    query: str,
    chunk_top_k: int,
) -> list[tuple[object, str]]:
    from agent.knowledge.factory import get_active_retriever

    retriever = get_active_retriever()

    source_by_collection: dict[str, str] = {}
    try:
        from agent.knowledge.scoping import get_scoped_collections_from_context

        for entry in get_scoped_collections_from_context() or []:
            _note_shelf_source(source_by_collection, entry)
    except Exception:
        logger.debug("surface_documents: no scoped shelves for retrieve", exc_info=True)

    async def _retrieve(collection: str) -> list[tuple[object, str]]:
        source = _source_for_target(collection, source_by_collection)
        if source is None:
            return []
        try:
            result = await retriever.retrieve(query=query, collection_name=collection, top_k=chunk_top_k, filters=None)
        except Exception:
            logger.warning("surface_documents: retrieval failed for %s", collection, exc_info=True)
            return []
        chunks = getattr(result, "chunks", None) or []
        return [(chunk, source) for chunk in chunks]

    gathered = await asyncio.gather(*(_retrieve(collection) for collection in targets))
    return [hit for group in gathered for hit in group]


def _note_shelf_source(source_by_collection: dict[str, str], entry: object) -> None:
    from agent.common.source_kinds import Shelf

    if entry.shelf is Shelf.OFFICE_SHELF:
        source_by_collection[entry.collection] = "office"
    elif entry.shelf is Shelf.PROJECT:
        source_by_collection[entry.collection] = "project"
