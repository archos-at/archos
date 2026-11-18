from __future__ import annotations

import logging
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Enrichment:
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
    from knowledge_layer.ingest import limits

    first = text_documents[0].get_content() if text_documents else ""
    last = text_documents[-1].get_content() if len(text_documents) > 1 else ""
    text_source = f"{first}\n...\n{last}" if last else first
    if drawing_pages and len(text_source.strip()) < limits.VISUAL_PAGE_MIN_TEXT_CHARS:
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
    if not (ingestor.generate_summary_enabled and (text_documents or drawing_pages)):
        return Enrichment()
    from agent.common.cost_tracking import submit_in_context
    from agent.knowledge import get_topic_vocabulary
    from agent.knowledge.document_classification import classify_document_tags
    from agent.knowledge.document_classification import suggest_topics
    from knowledge_layer.ingest.document_reading import _generate_document_summary

    llm_input = summary_input(text_documents, drawing_pages)
    llm = ingestor.summary_llm
    executor = ThreadPoolExecutor(max_workers=4)
    calls = Enrichment(executor=executor)
    calls.summary = submit_in_context(executor, _generate_document_summary, llm_input, file_name, llm)
    if not base_corpus:
        from agent.knowledge.dossier import write_dossier

        digest = _dossier_digest(all_documents, file_name)
        calls.dossier = submit_in_context(executor, write_dossier, digest, llm, file_name=file_name)
    calls.tags = submit_in_context(
        executor, classify_document_tags, llm_input, file_name, llm, organization_id=organization_id
    )
    calls.topics = submit_in_context(
        executor, suggest_topics, llm_input, file_name, llm, existing=get_topic_vocabulary(collection_name)
    )
    if suggest_class:
        from agent.knowledge.document_classification import suggest_doc_class

        calls.doc_class = submit_in_context(
            executor, suggest_doc_class, llm_input, file_name, organization_id=organization_id
        )
    return calls


def _dossier_digest(all_documents: list[Any], file_name: str) -> str:
    from agent.knowledge.dossier import build_digest
    from knowledge_layer.ingest import revisions
    from knowledge_layer.ingest.document_reading import _digest_passages

    return build_digest(
        _digest_passages(all_documents),
        file_name=file_name,
        title_block=revisions.revision_facts_from_documents(all_documents),
    )


def collect_enrichment(calls: Enrichment, stages: dict[str, float], file_name: str) -> EnrichmentResult:
    from knowledge_layer.ingest import limits
    from knowledge_layer.ingest.document_reading import _future_result
    from knowledge_layer.ingest.measures import _stage

    with _stage(stages, "summary"):
        summary = _future_result(calls.summary, "Summary generation", file_name)
        tags = _future_result(calls.tags, "Tag classification", file_name)
        topics = _future_result(calls.topics, "Topic suggestion", file_name)
    with _stage(stages, "dossier"):  # its own seconds: it reads every page
        dossier = _future_result(calls.dossier, "Dossier", file_name, timeout=limits.DOSSIER_TIMEOUT_SECONDS)
    if dossier and dossier.get("summary"):
        summary = dossier["summary"]
    calls.close()
    return EnrichmentResult(summary=summary, tags=tags, topics=topics, dossier=dossier)
