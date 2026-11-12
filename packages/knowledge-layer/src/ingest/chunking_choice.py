"""Which chunker cuts a PDF's text: its numbering, its headings, or its pages.

Moved out of ``adapter`` so the choice is testable without a job, a vector store or an
embedder, and so it can grow without growing the ingest job.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def is_released_text(job_config: Mapping[str, Any], collection_name: str) -> bool:
    """Whether the platform's records name this file as an edition's text (ADR-0173).

    Its job carries the edition AND writes the base corpus. An office's confirmed copy of an
    edition (its licensed ÖNORM, ``copyMarkForIngest``) carries the edition too, on its own
    shelf: it keeps the heading path, as every office upload does.
    """
    from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
    from knowledge_layer.vector_store import Physical
    from knowledge_layer.vector_store import physical_for_scope

    return physical_for_scope(collection_name) is Physical.CORPUS and bool(job_config.get(KNOWLEDGE_EDITION_FIELD))


def text_documents_for_pages(
    text_pages: list[dict[str, Any]], file_name: str, file_size: int, released_text: bool = False
) -> list[Any]:
    """Build the text Documents for one PDF, structure-aware where the document allows it.

    A numbered rule text cut on its own outline yields one requirement per chunk instead
    of roughly fifteen blended into a 1024-token block, and gives every chunk a Punkt to
    cite rather than only a page. ``clause_documents`` returns ``None`` for anything
    without a usable outline -- a glossary, a list of standards.

    Two kinds of file are cut on their numbering first:

    * a base-corpus file whose name the corpus's filename reader classes
      (``norm_registry.oib_doc_class``), the files uploaded before the platform's records.
      One the Punkt chunker cannot read (a glossary, a list of standards) keeps its pages;
    * a **released text** (``released_text``): the platform's records name the file as the
      text of an edition. The ingest job knows it by the ``knowledge_edition_id`` it
      carries, which the records' indexing job stores as the file's mark (ADR-0173) and
      every later job of the file carries, a plain re-ingest included (an office's confirmed
      copy of an edition carries it too, and is no released text: :func:`is_released_text`
      asks for the base corpus as well). Its name
      (``<manifestationKey>-<hash>.pdf``) is nothing a filename reader understands, and on
      the heading path its sub-Punkte, set in body type, were never headings: the chunk
      holding 5.1.1 to 5.1.4 of a Richtlinie was cited "5.1". The records decide, not
      ``doc_class``, which stays human-set (ADR-0064, Use 8): a released text's row reads
      ``other`` until a person sets it. A released text the Punkt chunker cannot read
      takes the heading path, as every released text did before. A released text that is
      not a Richtlinie but numbers long sections (a Leitfaden) is cut on its Punkte too:
      each piece of a long Punkt cites the Punkt's first page, where the heading path gave
      each chunk its own.

    Every other PDF is cut on its own headings FIRST (``section_chunking``): sections that
    span pages, chunks with a breadcrumb and a page each, overlap across page breaks,
    headings read from type as well as numbering. The Punkt chunker used to claim any
    tenant report numbered ``1``, ``1.1``, ``2`` … by numbering alone, and filed every piece
    of a long section under its first page; it is the fallback after the heading path.
    Whatever has no usable structure keeps the per-page path: one Document per page, its
    captioned tables put back as Markdown after the text they were cut out of
    (``page_text_with_tables``).
    """
    from knowledge_layer.ingest.clause_chunking import clause_documents
    from knowledge_layer.ingest.section_chunking import section_documents
    from llama_index.core import Document

    from agent.common.norm_registry import oib_doc_class

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
