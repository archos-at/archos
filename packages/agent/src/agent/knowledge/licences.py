from __future__ import annotations

from typing import Any


def document_licence(collection: str, file_name: str, *, unindexed: Any = None) -> Any:
    from knowledge_layer.estate import document_licence as read

    return read(collection, file_name, unindexed=unindexed)


def licensed_passage_sources(collection: str, file_name: str, page: int | None) -> tuple[Any, list[str]]:
    from knowledge_layer.estate import licensed_passage_sources as read

    return read(collection, file_name, page)
