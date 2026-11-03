"""The model calls that describe a file without shaping a chunk: summary, tags, topics, dossier, a class.

They start once the file's text and visuals are read, and the file's chunks are
embedded and written while they run: nothing a chunk carries comes from them
(``stamp_chunk_metadata`` reads only the Dokumentart and the provenance), so the
document is searchable before they answer. Their results are collected after the
write and land on the metadata row; the tags reach the points from there, by
``register_summary``'s copy (``writes.refresh_facts``), as a person's edit would.
The job reads terminal, and the settle push fires, only once they are collected.

Every call is fail-open and bounded (``_future_result``): a slow or failing
dossier costs the dossier, never the write.
"""

from __future__ import annotations

import logging
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Enrichment:
    """One file's enrichment calls in flight; :meth:`close` lets the pool go without waiting."""

    executor: ThreadPoolExecutor | None = None
    summary: Future | None = None
    tags: Future | None = None
    topics: Future | None = None
    dossier: Future | None = None
    doc_class: Future | None = None

    def close(self) -> None:
        if self.executor is not None:
            self.executor.shutdown(wait=False)


@dataclass
class EnrichmentResult:
    summary: str | None
    tags: list[str] | None
    topics: list[str] | None
    dossier: dict[str, Any] | None


def summary_input(text_documents: list[Any], drawing_pages: list[dict[str, Any]]) -> str:
    """What the summary, tags and topics read: the first and last chunk, else the drawings' captions.

    For a text-sparse drawing PDF the rendered-page descriptions are the
    document's real content; the near-empty (watermark-stripped) page text
    would make the summary describe nothing or a watermark.
    """
    from knowledge_layer.llamaindex import adapter as _adapter

    first = text_documents[0].get_content() if text_documents else ""
    last = text_documents[-1].get_content() if len(text_documents) > 1 else ""
    text_source = f"{first}\n...\n{last}" if last else first
    if drawing_pages and len(text_source.strip()) < _adapter.VISUAL_PAGE_MIN_TEXT_CHARS:
        return "\n\n".join(page["caption"] for page in drawing_pages) or text_source
    return text_source


def start_enrichment(
    ingestor: Any,
    *,
    text_documents: list[Any],
    drawing_pages: list[dict[str, Any]],
    all_documents: list[Any],
    file_name: str,
    collection_name: str,
    organization_id: str | None,
    base_corpus: bool,
    suggest_class: bool,
) -> Enrichment:
    """Start the calls (in the job's context, so they land on its cost ledger); none when summaries are off."""
    if not (ingestor.generate_summary_enabled and (text_documents or drawing_pages)):
        return Enrichment()
    from knowledge_layer.llamaindex import adapter as _adapter

    from agent.common.cost_tracking import submit_in_context
    from agent.knowledge import get_topic_vocabulary
    from agent.knowledge.document_classification import classify_document_tags
    from agent.knowledge.document_classification import suggest_topics

    llm_input = summary_input(text_documents, drawing_pages)
    llm = ingestor.summary_llm
    executor = ThreadPoolExecutor(max_workers=4)
    calls = Enrichment(executor=executor)
    calls.summary = submit_in_context(executor, _adapter._generate_document_summary, llm_input, file_name, llm)
    # The dossier reads the WHOLE document (a digest of every page). Not for the
    # base corpus: a Richtlinie is not a project document, and its clauses carry its structure.
    if not base_corpus:
        from agent.knowledge.dossier import write_dossier

        # The digest is built here, before the chunks are stamped for the write.
        digest = _dossier_digest(all_documents, file_name)
        calls.dossier = submit_in_context(executor, write_dossier, digest, llm, file_name=file_name)
    calls.tags = submit_in_context(
        executor, classify_document_tags, llm_input, file_name, llm, organization_id=organization_id
    )
    # The model's own topics, told the project's existing ones first so its spellings hold.
    calls.topics = submit_in_context(
        executor, suggest_topics, llm_input, file_name, llm, existing=get_topic_vocabulary(collection_name)
    )
    # A base-corpus file whose name gives no OIB hint: the decision model proposes a
    # Dokumentart for the platform owner to accept (ADR-0064, use 8).
    if suggest_class:
        from agent.knowledge.document_classification import suggest_doc_class

        calls.doc_class = submit_in_context(
            executor, suggest_doc_class, llm_input, file_name, organization_id=organization_id
        )
    return calls


def _dossier_digest(all_documents: list[Any], file_name: str) -> str:
    from knowledge_layer.llamaindex import adapter as _adapter

    from agent.knowledge.dossier import build_digest

    return build_digest(
        _adapter._digest_passages(all_documents),
        file_name=file_name,
        title_block=_adapter.revisions.revision_facts_from_documents(all_documents),
    )


def collect_enrichment(calls: Enrichment, stages: dict[str, float], file_name: str) -> EnrichmentResult:
    """Each call's answer, or ``None`` when it was not started, timed out or failed. The dossier's summary wins."""
    from knowledge_layer.llamaindex import adapter as _adapter

    with _adapter._stage(stages, "summary"):
        summary = _adapter._future_result(calls.summary, "Summary generation", file_name)
        tags = _adapter._future_result(calls.tags, "Tag classification", file_name)
        topics = _adapter._future_result(calls.topics, "Topic suggestion", file_name)
    with _adapter._stage(stages, "dossier"):  # its own seconds: it reads every page
        dossier = _adapter._future_result(calls.dossier, "Dossier", file_name, timeout=_adapter.DOSSIER_TIMEOUT_SECONDS)
    # Written from every page rather than the first and last chunk.
    if dossier and dossier.get("summary"):
        summary = dossier["summary"]
    calls.close()
    return EnrichmentResult(summary=summary, tags=tags, topics=topics, dossier=dossier)
