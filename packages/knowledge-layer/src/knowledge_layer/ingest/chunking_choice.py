from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def is_released_text(job_config: Mapping[str, Any], collection_name: str) -> bool:
    from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
    from knowledge_layer.vector_store import Physical
    from knowledge_layer.vector_store import physical_for_scope

    return physical_for_scope(collection_name) is Physical.CORPUS and bool(job_config.get(KNOWLEDGE_EDITION_FIELD))


def text_documents_for_pages(
    text_pages: list[dict[str, Any]], file_name: str, file_size: int, released_text: bool = False
) -> list[Any]:
    from llama_index.core import Document

    from agent.common.norm_registry import oib_doc_class
    from knowledge_layer.ingest.clause_chunking import clause_documents
    from knowledge_layer.ingest.section_chunking import section_documents

    corpus_file = oib_doc_class(file_name) is not None
    structured = clause_documents(text_pages, file_name, file_size) if released_text else None
    if structured is not None:
        return structured
    sectioned = None if corpus_file else section_documents(text_pages, file_name, file_size)
    if sectioned is not None:
        return sectioned
    structured = None if released_text else clause_documents(text_pages, file_name, file_size)
    if structured is not None:
        return structured
    from knowledge_layer.ingest.captioned_tables import page_text_with_tables

    return [
        Document(
            text=page_text_with_tables(page["text"], page.get("tables") or []),
            metadata={
                "file_name": file_name,
                "file_size": file_size,
                "page_label": str(page["page_number"]),
                "content_type": "text",
            },
        )
        for page in text_pages
    ]
