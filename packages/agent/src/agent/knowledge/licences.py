from __future__ import annotations

from typing import Any


def document_licence(collection: str, file_name: str, *, unindexed: Any = None, document_id: str | None = None) -> Any:
    from knowledge_layer.estate import document_licence as read

    return read(collection, file_name, unindexed=unindexed, document_id=document_id)


def licensed_passage_sources(
    collection: str, file_name: str, page: int | None, *, document_id: str | None = None
) -> tuple[Any, list[str]]:
    from knowledge_layer.estate import licensed_passage_sources as read

    return read(collection, file_name, page, document_id=document_id)
