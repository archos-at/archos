from typing import Any

from .chunk_metadata import stamp_chunk_metadata
from .chunking_choice import text_documents_for_pages

DEFAULT_CHUNK_SIZE = 1024
DEFAULT_CHUNK_OVERLAP = 128


def split_documents(documents: list[Any], *, chunk_size: int, chunk_overlap: int) -> list[Any]:
    from llama_index.core.node_parser import SentenceSplitter

    return SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap).get_nodes_from_documents(documents)


def text_chunks_for_pages(
    text_pages: list[dict[str, Any]],
    file_name: str,
    file_size: int,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    doc_class: Any = None,
) -> list[Any]:
    documents = text_documents_for_pages(text_pages, file_name, file_size)
    stamp_chunk_metadata(documents, doc_class=doc_class, provenance={}, chunk_size=chunk_size, file_name=file_name)
    return split_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def page_texts_for_visual_heuristic(text_pages: list[dict[str, Any]]) -> dict[int, str]:
    from knowledge_layer.ingest.captioned_tables import page_text_with_tables

    return {page["page_number"]: page_text_with_tables(page["text"], page.get("tables") or []) for page in text_pages}
