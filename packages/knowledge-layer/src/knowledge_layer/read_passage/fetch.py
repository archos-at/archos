from __future__ import annotations

import asyncio
from typing import Any

from .models import Fetched
from .models import PassageTarget
from .ranges import _locus_label


def _fetch_query(document: str, clause: str | None, page: int | None) -> str:
    return _locus_label(document, clause, page)


async def _structural_fetch(
    retriever: Any,
    collection: str,
    filters: dict[str, Any],
    top_k: int,
    start_from: tuple[Any, ...] | None = None,
) -> list[Any] | None:
    from agent.knowledge.base import READING_ORDER

    fetch = getattr(retriever, "fetch", None)
    if fetch is None:
        return None
    if start_from is not None:
        return await fetch(collection_name=collection, filters=filters, limit=top_k, start_from=start_from)
    return await fetch(collection_name=collection, filters=filters, limit=top_k, order_by=READING_ORDER)


async def _fetch(
    target: PassageTarget,
    filters: dict[str, Any],
    query: str,
    top_k: int,
    start_from: tuple[Any, ...] | None = None,
) -> tuple[list[Any], bool]:
    from agent.knowledge.factory import get_active_retriever

    retriever = get_active_retriever()
    chunks = await _structural_fetch(retriever, target.collection, filters, top_k, start_from)
    structural = chunks is not None
    if chunks is None:
        result = await retriever.retrieve(
            query=query,
            collection_name=target.collection,
            top_k=top_k,
            filters=filters,
        )
        chunks = list(getattr(result, "chunks", None) or [])
    for chunk in chunks:
        chunk.metadata.setdefault("collection", target.collection)
        if target.shelf:
            chunk.metadata.setdefault("shelf", target.shelf)
    return chunks, structural


async def _fetch_all(
    targets: list[PassageTarget],
    filters_for,
    query: str,
    top_k: int,
    start_from: tuple[Any, ...] | None = None,
) -> Fetched:
    fetched = await asyncio.gather(
        *(_fetch(target, filters_for(target.file_name), query, top_k, start_from) for target in targets),
        return_exceptions=True,
    )
    answered = [group for group in fetched if not isinstance(group, BaseException)]
    return Fetched(
        chunks=[chunk for chunks, _structural in answered for chunk in chunks],
        failures=[group for group in fetched if isinstance(group, BaseException)],
        structural=bool(answered) and all(structural for _chunks, structural in answered),
    )
