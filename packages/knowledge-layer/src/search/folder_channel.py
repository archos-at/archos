from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from typing import Any

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    from agent.knowledge.folder_cards import gate
    from agent.project_context import get_organization_id_from_context

    return gate.enabled_for(get_organization_id_from_context())


def _office_scopes(collections: Sequence[str]) -> list[str]:
    from knowledge_layer.vector_store import Physical
    from knowledge_layer.vector_store import physical_for_scope

    return [name for name in dict.fromkeys(collections) if physical_for_scope(name) is Physical.OFFICE]


def _routes(retriever: Any, scopes: list[str], query_text: str, folder: str | None, hint: str) -> str:
    from knowledge_layer.vector_store import get_store
    from knowledge_layer.vector_store import render_folder_hits
    from knowledge_layer.vector_store import search_folders

    vector = retriever.embed_query(query_text)
    store = get_store(retriever.embedding_identity())
    store.check_identity(scopes[0])
    return render_folder_hits(search_folders(store, scopes, vector, folder=folder), hint)


async def folder_routes(
    retriever: Any, collections: Sequence[str], query_text: str, *, folder: str | None, hint: str
) -> str:
    scopes = _office_scopes(collections)
    if not scopes or not await asyncio.to_thread(_enabled):
        return ""
    try:
        return await asyncio.to_thread(_routes, retriever, scopes, query_text, folder, hint.replace('"', "'"))
    except Exception:  # noqa: BLE001 - the passages are the answer; a folder is a hint
        logger.debug("Folder channel skipped", exc_info=True)
        return ""
