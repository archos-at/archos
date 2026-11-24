from __future__ import annotations

from typing import Any

MAX_CHUNKS = 4096


def read_pages(collection: str, file_name: str) -> list[tuple[Any, str]] | None:
    hits = _document_hits(collection, file_name)
    return [(hit.payload.get("page_label"), text) for hit, text in zip(hits, own_page_texts(hits)) if text] or None


def own_page_texts(hits: list[Any]) -> list[str]:
    from types import SimpleNamespace

    from knowledge_layer.chunk_positions import own_texts

    views = [
        SimpleNamespace(
            chunk_id=str(getattr(hit, "chunk_id", "") or ""),
            content=hit.text or "",
            metadata=hit.payload or {},
            file_name=(hit.payload or {}).get("file_name"),
            content_type=(hit.payload or {}).get("content_type"),
            page_number=(hit.payload or {}).get("page_label"),
        )
        for hit in hits
    ]
    return [(own.text[: own.repeat_start] + own.text[own.repeat_end :].lstrip()).strip() for own in own_texts(views)]


def read_chunks(collection: str, file_name: str) -> list[tuple[str, dict[str, Any]]] | None:
    from knowledge_layer.vector_store import chunk_metadata

    hits = _document_hits(collection, file_name)
    return [(hit.text, chunk_metadata(hit.payload)) for hit in hits if hit.text] or None


def _document_hits(collection: str, file_name: str) -> list[Any]:
    from knowledge_layer.vector_store import fetch
    from knowledge_layer.vector_store import in_document_order

    return in_document_order(fetch(collection, {"file_name": file_name}, MAX_CHUNKS))
