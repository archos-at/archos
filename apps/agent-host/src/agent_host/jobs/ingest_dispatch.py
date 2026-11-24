from __future__ import annotations

import logging
from typing import Any

from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge import ingest_workflow
from agent.knowledge.base import BaseIngestor
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.ingest_execution import UNREADABLE_JOB_MESSAGE  # noqa: F401 - re-exported
from agent.knowledge.ingest_execution import unreadable_job_failure  # noqa: F401 - re-exported
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState

from ..object_store_url import object_store_request_url
from . import payload_crypto

logger = logging.getLogger(__name__)

_DEFERRED_CONFIG_LISTS = ("extraction_paths", "preview_paths")

_URL_CONFIG_KEYS = ("thumbnail_upload_url",)

_DOWNLOAD = "__object_download__"
_CORPUS_OBJECT = "__corpus_object__"
_ENCRYPTED = "enc:"


def _encode_entry(entry: Any) -> Any:
    from agent.corpus_store import CorpusObjectDownload

    from ..routes.ingest import DeferredObjectDownload

    if isinstance(entry, DeferredObjectDownload):
        return {_DOWNLOAD: entry.to_payload()}
    if isinstance(entry, CorpusObjectDownload):
        return {_CORPUS_OBJECT: entry.to_payload()}
    return entry


def durable(prepared: PreparedIngestJob) -> bool:
    from agent.corpus_store import CorpusObjectDownload

    from ..routes.ingest import DeferredObjectDownload

    entries = list(prepared.file_paths)
    for key in _DEFERRED_CONFIG_LISTS:
        entries.extend(prepared.config.get(key) or [])
    return bool(prepared.file_paths) and all(
        isinstance(e, (DeferredObjectDownload, CorpusObjectDownload)) for e in entries
    )


def encode(prepared: PreparedIngestJob) -> str:
    config = dict(prepared.config)
    for key in _DEFERRED_CONFIG_LISTS:
        if key in config:
            config[key] = [_encode_entry(e) for e in config[key]]
    return payload_crypto.serialize(
        {
            "job_id": prepared.job_id,
            "status": prepared.status.model_dump(mode="json"),
            "file_paths": [_encode_entry(e) for e in prepared.file_paths],
            "collection_name": prepared.collection_name,
            "config": config,
        }
    )


def _decode_entry(entry: Any) -> Any:
    from agent.corpus_store import CorpusObjectDownload

    from ..routes.ingest import DeferredObjectDownload

    if isinstance(entry, dict) and _DOWNLOAD in entry:
        return DeferredObjectDownload.from_payload(entry[_DOWNLOAD])
    if isinstance(entry, dict) and _CORPUS_OBJECT in entry:
        return CorpusObjectDownload.from_payload(entry[_CORPUS_OBJECT])
    raise ValueError("a queued ingestion job may only carry object-store downloads")


def decode(stored: str) -> PreparedIngestJob:
    data = payload_crypto.deserialize(stored)
    config = dict(data["config"])
    for key in _DEFERRED_CONFIG_LISTS:
        if key in config:
            config[key] = [_decode_entry(e) for e in config[key]]
    for key in _URL_CONFIG_KEYS:
        if config.get(key):
            config[key] = object_store_request_url(config[key], field=key)
    return PreparedIngestJob(
        job_id=data["job_id"],
        status=IngestionJobStatus.model_validate(data["status"]),
        file_paths=[_decode_entry(e) for e in data["file_paths"]],
        collection_name=data["collection_name"],
        config=config,
    )


class QueueUnavailable(RuntimeError): ...


def _hand_over(prepared: PreparedIngestJob) -> bool:
    payload = encode(prepared)
    if not payload.startswith(_ENCRYPTED):
        raise QueueUnavailable("JOB_PAYLOAD_KEK is not set: a job's payload never leaves this tier in plaintext")
    try:
        return ingest_workflow.trigger(
            prepared.job_id,
            prepared.organization_id,
            prepared.priority,
            payload,
            document_id=document_of(prepared),
            byte_size=original_bytes(prepared),
        )
    except Exception as error:
        raise QueueUnavailable(
            f"could not hand ingestion job {prepared.job_id} to Hatchet: {type(error).__name__}"
        ) from error


def document_of(prepared: PreparedIngestJob) -> str | None:
    document_id = prepared.config.get("document_id")
    if len(prepared.file_paths) != 1 or not isinstance(document_id, str) or not document_id:
        return None
    return document_id


def original_bytes(prepared: PreparedIngestJob) -> int | None:
    size = prepared.config.get("original_bytes")
    return size if isinstance(size, int) and not isinstance(size, bool) and size >= 0 else None


def dispatch(ingestor: BaseIngestor, prepared: PreparedIngestJob) -> None:
    if prepared.status.status != JobState.PENDING:
        return
    if getattr(ingestor, "supports_durable_jobs", False) is True and durable(prepared):
        try:
            _hand_over(prepared)
            logger.info("Ingestion job %s handed to Hatchet", prepared.job_id)
            return
        except QueueUnavailable as error:
            logger.warning("Running ingestion job %s here: %s", prepared.job_id, error)
    ingestor.submit_prepared(prepared)


def enqueue_only(prepared: PreparedIngestJob) -> bool:
    if prepared.status.status != JobState.PENDING:
        raise QueueUnavailable(f"ingestion job {prepared.job_id} was not accepted: {prepared.status.error_message}")
    if not durable(prepared):
        raise QueueUnavailable(f"ingestion job {prepared.job_id} cannot run in another process")
    return _hand_over(prepared)


CANCEL_STOPPED = "cancelled"
CANCEL_FINISHED = "finished"
CANCEL_UNAVAILABLE = "unavailable"


def cancel(job_id: str) -> str:
    status = ingest_status_store.get(job_id)
    if status is None or status.status not in (JobState.PENDING, JobState.PROCESSING):
        return CANCEL_FINISHED
    run_id = ingest_run_hold.run_id_of(job_id)
    if run_id is None:
        return CANCEL_UNAVAILABLE
    ingest_run_hold.mark_stopped_by_person(job_id)
    try:
        ingest_workflow.cancel_run(run_id)
    except Exception as error:  # noqa: BLE001 - the route reports it; the job runs on
        logger.warning("Could not cancel the run of ingestion job %s: %s", job_id, type(error).__name__)
        return CANCEL_UNAVAILABLE
    if not ingest_status_store.settle_cancelled(job_id):
        after = ingest_status_store.get(job_id)
        if after is not None and after.status in (JobState.COMPLETED, JobState.FAILED):
            return CANCEL_FINISHED
    return CANCEL_STOPPED


def stamp_queue_ahead(statuses: dict[str, Any]) -> None:
    for status in statuses.values():
        if status and status.get("status") == JobState.PENDING.value:
            status.setdefault("metadata", {})["queue_ahead"] = None
