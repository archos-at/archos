"""Step 4 of the page fan-out: the summary, tags, topics, dossier and permit, after the chunks are written.

With ``INGEST_PAGE_FAN_OUT`` on, the write leaves these calls to steps of their own
(``ingest_enrichment.deferred``): their inputs are stored beside the version
(``step_outputs.ENRICHMENT_PART``), and the file's row carries the fallback
summary until :func:`write_rows` replaces it. Each call is a step
(:func:`enrich_part`) that stores its answer and returns only whether it has one;
the permit (:func:`remember_permit`) follows the tags and runs only for a
document they typed a Bescheid (or positively as another kind, whose record it
drops); :func:`write_rows` joins them onto the row.

Every step is fail-open, like the calls it replaces: a failed call is an
answer of ``None``, never a failed file. Free of the orchestrator's SDK.

Not carried over from the in-pipeline enrichment (named in ADR-0151): the
Fassung change line is told against the fallback summary, and the dossier does
not see the replaced version's dossier.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

from . import step_outputs

logger = logging.getLogger(__name__)


def _inputs(prepared: Any, content_hash: str | None) -> tuple[step_outputs.StepOutputs | None, dict[str, Any] | None]:
    if not content_hash:
        return None, None
    store = step_outputs.for_job(prepared, content_hash)
    inputs = store.get(step_outputs.ENRICHMENT_PART)
    return store, inputs if isinstance(inputs, dict) else None


def _call(name: str, ingestor: Any, inputs: dict[str, Any]) -> Any:
    from . import adapter

    llm = ingestor.summary_llm
    text, file_name = inputs["llm_input"], inputs["file_name"]
    if name == "summary":
        return adapter._generate_document_summary(text, file_name, llm)
    if name == "tags":
        from agent.knowledge.document_classification import classify_document_tags

        return classify_document_tags(text, file_name, llm, organization_id=inputs.get("organization_id"))
    if name == "topics":
        from agent.knowledge import get_topic_vocabulary
        from agent.knowledge.document_classification import suggest_topics

        return suggest_topics(text, file_name, llm, existing=get_topic_vocabulary(inputs["collection"]))
    if not inputs.get("digest"):
        return None
    from agent.knowledge.dossier import write_dossier

    return write_dossier(inputs["digest"], llm, file_name=file_name)


def enrich_part(ingestor: Any, prepared: Any, name: str, content_hash: str | None) -> dict[str, Any]:
    """One enrichment call, its answer stored as ``enrichment/<name>.json``; ``found`` and, for the tags, ``permit``."""
    store, inputs = _inputs(prepared, content_hash)
    if store is None or inputs is None or not ingestor.summary_llm:
        return {"part": name, "found": False, "permit": False}
    try:
        answer = _call(name, ingestor, inputs)
    except Exception as exc:  # noqa: BLE001 - fail-open, as in the pipeline: the call costs its answer
        logger.warning("Enrichment step %s failed for job %s (%s)", name, prepared.job_id, type(exc).__name__)
        answer = None
    if name == "tags" and inputs.get("suggest_class"):
        answer = {"tags": answer, "doc_class": _suggest_class(inputs)}
    stored = store.put(step_outputs.enrichment_part(name), answer) if answer is not None else False
    return {"part": name, "found": bool(stored), "permit": name == "tags" and _permit_relevant(answer)}


def _suggest_class(inputs: dict[str, Any]) -> str | None:
    from agent.knowledge.document_classification import suggest_doc_class

    try:
        return suggest_doc_class(
            inputs["llm_input"], inputs["file_name"], organization_id=inputs.get("organization_id")
        )
    except Exception:  # noqa: BLE001 - a suggestion is optional
        return None


def _tags_of(answer: Any) -> list[str] | None:
    return answer.get("tags") if isinstance(answer, dict) else answer


def _permit_relevant(answer: Any) -> bool:
    from agent.knowledge.permit_extraction import is_permit_decision
    from agent.knowledge.permit_extraction import typed_as_something_else

    tags = _tags_of(answer)
    return is_permit_decision(tags) or typed_as_something_else(tags)


def _documents(inputs: dict[str, Any], *, text_only: bool = False) -> list[Any]:
    """The light documents back as objects ``_reading_of`` and ``_remember_permit`` read."""
    return [
        SimpleNamespace(
            metadata={"page_label": doc.get("p"), **({"drawing_data": doc["d"]} if doc.get("d") else {})},
            get_content=lambda text=doc.get("t") or "": text,
        )
        for doc in inputs.get("documents") or []
        if doc.get("x") or not text_only
    ]


def remember_permit(ingestor: Any, prepared: Any, content_hash: str | None) -> dict[str, Any]:
    """The permit record of a document its tags typed: extracted for a Bescheid, dropped for another kind."""
    store, inputs = _inputs(prepared, content_hash)
    if store is None or inputs is None:
        return {"permit": False}
    tags = _tags_of(store.get(step_outputs.enrichment_part("tags")))
    config = ingestor._job_config(prepared)
    ingestor._remember_permit(
        config, inputs["collection"], inputs["file_name"], tags, _documents(inputs, text_only=True)
    )
    return {"permit": True}


def write_rows(ingestor: Any, prepared: Any, content_hash: str | None) -> dict[str, Any]:
    """Join the answers onto the file's row: summary, tags and topics, then the dossier with its references."""
    from agent.knowledge import collection_version
    from agent.knowledge import get_documents
    from agent.knowledge import register_summary
    from agent.knowledge import set_document_doc_class_suggestion
    from agent.knowledge import set_document_reading

    store, inputs = _inputs(prepared, content_hash)
    if store is None or inputs is None:
        return {"written": False}
    collection, file_name = inputs["collection"], inputs["file_name"]
    found = {name: store.get(step_outputs.enrichment_part(name)) for name in step_outputs.ENRICHMENT_NAMES}
    rows = get_documents(collection, [file_name])
    row = rows[0] if rows else None
    dossier = found["dossier"] if isinstance(found["dossier"], dict) else None
    summary = (dossier or {}).get("summary") or found["summary"] or (row.summary if row else None)
    register_summary(collection, file_name, summary, tags=_tags_of(found["tags"]), topics=found["topics"])
    if isinstance(found["tags"], dict) and found["tags"].get("doc_class"):
        set_document_doc_class_suggestion(collection, file_name, found["tags"]["doc_class"])
    if dossier is not None:
        from . import adapter

        reading, references = adapter._reading_of(_documents(inputs), dossier, None)
        set_document_reading(
            collection, file_name, dossier=reading, references=references, coverage=row.coverage if row else None
        )
    collection_version.bump(collection)
    return {"written": True, "found": sorted(name for name, value in found.items() if value is not None)}
