import json
import logging
from dataclasses import dataclass
from typing import Any

from . import chosen_document_type
from . import limits
from . import revisions
from . import row_facts
from .caption_documents import _scrub_watermark_phrases
from .caption_documents import _strip_visual_marker
from .caption_documents import _summary_from_drawing_fields
from .document_reading import _future_result
from .document_reading import _predecessor_dossier
from .document_reading import _reading_of
from .file_ingest import Extracted
from .file_ingest import FileRun
from .ingest_run import JobRun

logger = logging.getLogger(__name__)


@dataclass
class _Facts:
    summary: str | None
    tags: list[str] | None
    topics: list[str] | None
    dossier: dict[str, Any] | None
    chosen_type: Any = None
    confirmed_older: str | None = None
    revision_model: bool = False


def record_facts(
    ingestor: Any,
    run: JobRun,
    file: FileRun,
    extracted: Extracted,
    enrichment: Any,
    all_documents: list[Any],
    provenance: dict[str, Any],
) -> None:
    from knowledge_layer.ingest import enrichment as ingest_enrichment

    found = ingest_enrichment.collect_enrichment(enrichment, file.stages, file.file_name)
    facts = _Facts(found.summary, found.tags, found.topics, found.dossier)
    text_documents = extracted.text_documents

    if file.is_image and text_documents:
        from agent.knowledge.document_classification import reconcile_image_tags

        facts.tags = reconcile_image_tags(
            facts.tags,
            content_type=text_documents[0].metadata.get("content_type"),
            segment_types=(doc.metadata.get("drawing_type") or "" for doc in text_documents),
        )

    facts.chosen_type, facts.tags = chosen_document_type.apply(run.config, facts.tags)

    ingestor._remember_permit(run.config, run.collection_name, file.file_name, facts.tags, text_documents)

    facts.summary = _fallback_summary(facts.summary, file, extracted)

    confirmed_older = (run.config.get("revision_of") or run.config.get("fassung_of") or "").strip() or None
    if file.base_corpus or len(run.file_paths) != 1:
        confirmed_older = None
    facts.confirmed_older = confirmed_older
    facts.revision_model = bool(not file.base_corpus and ingestor.generate_summary_enabled and ingestor.summary_llm)

    if facts.summary:
        _record_summary(ingestor, run, file, facts, enrichment, all_documents, provenance)

    if facts.confirmed_older and not (facts.summary and facts.revision_model):
        ingestor._bounded(
            "Fassung",
            file.file_name,
            limits.REVISION_TIMEOUT_SECONDS,
            revisions.confirm_revision,
            run.collection_name,
            file.file_name,
            facts.confirmed_older,
            summary=facts.summary or "",
            doc_class=file.doc_class,
            tags=facts.tags,
            llm=None,
        )


def _fallback_summary(summary: str | None, file: FileRun, extracted: Extracted) -> str | None:
    text_documents = extracted.text_documents
    if file.is_image and not summary and text_documents:
        caption_text = _scrub_watermark_phrases(_strip_visual_marker(text_documents[0].get_content()))
        summary = caption_text[:500] or None

    if not summary and extracted.drawing_pages:
        summary = _summary_from_drawing_fields(extracted.drawing_pages)

    if not summary and text_documents:
        from agent.knowledge.document_classification import fallback_summary_from_text

        first_text = text_documents[0].get_content()
        last_text = text_documents[-1].get_content() if len(text_documents) > 1 else ""
        fallback_source = f"{first_text}\n{last_text}" if last_text else first_text
        summary = fallback_summary_from_text(fallback_source)
    return summary


def _record_summary(
    ingestor: Any,
    run: JobRun,
    file: FileRun,
    facts: _Facts,
    enrichment: Any,
    all_documents: list[Any],
    provenance: dict[str, Any],
) -> None:
    from agent.knowledge import register_summary
    from agent.knowledge import set_document_reading

    collection_name, file_name, previous = run.collection_name, file.file_name, file.previous
    stored_names = previous.stored_names if previous else ()
    revision_rows = revisions.read_rows(collection_name) if facts.revision_model else []
    summary_before = revisions.previous_summary(revision_rows, stored_names)

    register_summary(collection_name, file_name, facts.summary, tags=facts.tags, topics=facts.topics)
    revision_facts = row_facts.store_read_facts(
        collection_name,
        file_name,
        all_documents,
        photo=file.photo,
        config=run.config,
        replaced=previous is not None,
    )

    reading, references = _reading_of(
        all_documents,
        facts.dossier,
        _predecessor_dossier(revision_rows, stored_names, facts.confirmed_older),
    )
    set_document_reading(collection_name, file_name, dossier=reading, references=references, coverage=file.coverage)

    _record_doc_class(run, file, enrichment)
    _carry_person_facts(run, file, facts)
    _carry_provenance_and_links(run, file, provenance)

    if facts.revision_model:
        ingestor._bounded(
            "Fassung",
            file_name,
            limits.REVISION_TIMEOUT_SECONDS,
            revisions.record_revisions,
            collection_name,
            file_name,
            replaced=previous is not None,
            rows=revision_rows,
            previous=summary_before,
            summary=facts.summary,
            doc_class=file.doc_class,
            tags=facts.tags,
            llm=ingestor.summary_llm,
            confirmed_older=facts.confirmed_older,
            revision_facts=revision_facts,
        )

    logger.info(f"  Summary generated ({len(facts.summary)} chars)")


def _record_doc_class(run: JobRun, file: FileRun, enrichment: Any) -> None:
    from agent.knowledge import set_document_doc_class

    if file.row_doc_class is None or file.explicit_doc_class is not None:
        set_document_doc_class(run.collection_name, file.file_name, file.doc_class)
    suggestion = _future_result(enrichment.doc_class, "Dokumentart suggestion", file.file_name)
    if suggestion or file.previous is not None:
        from agent.knowledge import set_document_doc_class_suggestion

        set_document_doc_class_suggestion(run.collection_name, file.file_name, suggestion)


def _carry_person_facts(run: JobRun, file: FileRun, facts: _Facts) -> None:
    from agent.knowledge import set_document_folder_path

    collection_name, file_name, preserved = run.collection_name, file.file_name, file.preserved
    folder_path = (run.config.get("folder_path") or "").strip() or None
    folder_path = folder_path or preserved.get("folder_path")
    if folder_path:
        set_document_folder_path(collection_name, file_name, folder_path)
    chosen_document_type.carry_person_tags(collection_name, file_name, preserved, facts.chosen_type, facts.tags)
    if "topics" in preserved:
        from agent.knowledge import set_document_topics_by_person

        set_document_topics_by_person(collection_name, file_name, json.loads(preserved["topics"]))
    _carry_display_title(run, file)


def _carry_display_title(run: JobRun, file: FileRun) -> None:
    from agent.knowledge import set_document_display_title

    if file.preserved.get("display_title"):
        set_document_display_title(run.collection_name, file.file_name, file.preserved["display_title"])
        return
    if not file.base_corpus:
        return
    from agent.common.norm_registry import guess_display_title

    default_title = guess_display_title(file.file_name)
    if default_title:
        set_document_display_title(run.collection_name, file.file_name, default_title)


def _carry_provenance_and_links(run: JobRun, file: FileRun, provenance: dict[str, Any]) -> None:
    collection_name, file_name = run.collection_name, file.file_name
    if provenance or file.previous is not None:
        from agent.knowledge import set_document_provenance

        set_document_provenance(collection_name, file_name, provenance)

    carried_link, carried_suggestion = revisions.carried_links(file.preserved)
    if carried_link:
        from agent.knowledge import set_document_superseded_by

        set_document_superseded_by(collection_name, file_name, carried_link)
    if carried_suggestion:
        from agent.knowledge import set_document_revision_suggestion

        set_document_revision_suggestion(collection_name, file_name, carried_suggestion)
