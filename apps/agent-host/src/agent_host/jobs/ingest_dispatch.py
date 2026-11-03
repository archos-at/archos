"""Where an ingestion job runs: Hatchet's ``ingest-document`` task, on any ingest worker.

A job whose original is at least ``INGEST_HEAVY_FILE_BYTES`` (the BFF states its
size as ``byte_size``) runs as ``ingest-document-heavy`` on the high-memory pool
instead, and every job of one document carries its id, so a newer upload of it
supersedes the run still reading the old bytes (``ingest_hatchet``).

``POST /v1/ingest`` prepares a job (validated, recorded PENDING) and hands it to
Hatchet (``agent.knowledge.ingest_hatchet``, ADR-0150), which runs it on the
ingest-worker tier (``ingest_worker``), fair across organisations: the ``chat``
and ``api`` roles accept jobs and never run them. A job survives the restart of
the replica that accepted it, and ingestion scales apart from the web tiers.

A job goes to Hatchet when the ingestor can run it elsewhere and every file is a
deferred object-store download (a local path exists only on the replica that
wrote it). Otherwise, and whenever Hatchet cannot take it, the job runs in this
process's own pool.

The payload carries presigned URLs, bearer credentials to a tenant's objects, so
it is encrypted (``payload_crypto``, ``JOB_PAYLOAD_KEK``) before it leaves this
tier, and every URL passes the SSRF gates again when a worker reads it back.
Without a key nothing goes to Hatchet: its database must hold no tenant content.

A person may stop a job (:func:`cancel`): its status settles ``cancelled`` and
its run is cancelled by id, so a waiting run never starts and a running one stops
at its next ownership check, before it reads or writes.
"""

from __future__ import annotations

import logging
from typing import Any

from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge.base import BaseIngestor
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.ingest_execution import UNREADABLE_JOB_MESSAGE  # noqa: F401 - re-exported
from agent.knowledge.ingest_execution import unreadable_job_failure  # noqa: F401 - re-exported
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState

from . import payload_crypto

logger = logging.getLogger(__name__)

#: The config keys whose entries are deferred downloads, beside ``file_paths``:
#: the rendition a document is read from, and the one only its thumbnail is
#: drawn from (``knowledge_layer.renditions.RENDITION_CONFIG_LISTS``).
_DEFERRED_CONFIG_LISTS = ("extraction_paths", "preview_paths")

#: Config keys that are URLs a worker requests: gated again on the way back in.
_URL_CONFIG_KEYS = ("thumbnail_upload_url",)

_DOWNLOAD = "__object_download__"
_CORPUS_OBJECT = "__corpus_object__"
#: How an encrypted payload begins (``payload_crypto.serialize``).
_ENCRYPTED = "enc:"


# ----------------------------------------------------------------- payload


def _encode_entry(entry: Any) -> Any:
    from agent.corpus_store import CorpusObjectDownload

    from ..routes.ingest import DeferredObjectDownload

    if isinstance(entry, DeferredObjectDownload):
        return {_DOWNLOAD: entry.to_payload()}
    if isinstance(entry, CorpusObjectDownload):
        return {_CORPUS_OBJECT: entry.to_payload()}
    return entry


def durable(prepared: PreparedIngestJob) -> bool:
    """Whether the job can run in another process: every file a deferred download."""
    from agent.corpus_store import CorpusObjectDownload

    from ..routes.ingest import DeferredObjectDownload

    entries = list(prepared.file_paths)
    for key in _DEFERRED_CONFIG_LISTS:
        entries.extend(prepared.config.get(key) or [])
    return bool(prepared.file_paths) and all(
        isinstance(e, (DeferredObjectDownload, CorpusObjectDownload)) for e in entries
    )


def encode(prepared: PreparedIngestJob) -> str:
    """The job as a run carries it: encrypted, with its downloads as plain data."""
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
    """Inverse of ``encode``; raises on anything a worker must not run."""
    from ..routes.ingest import _assert_fetchable_object_store_url

    data = payload_crypto.deserialize(stored)
    config = dict(data["config"])
    for key in _DEFERRED_CONFIG_LISTS:
        if key in config:
            config[key] = [_decode_entry(e) for e in config[key]]
    for key in _URL_CONFIG_KEYS:
        if config.get(key):
            _assert_fetchable_object_store_url(config[key], field=key)
    return PreparedIngestJob(
        job_id=data["job_id"],
        status=IngestionJobStatus.model_validate(data["status"]),
        file_paths=[_decode_entry(e) for e in data["file_paths"]],
        collection_name=data["collection_name"],
        config=config,
    )


# ---------------------------------------------------------------- dispatch


class QueueUnavailable(RuntimeError):
    """The job cannot be handed to Hatchet, and its caller has no other place to run it."""


def _hand_over(prepared: PreparedIngestJob) -> bool:
    """Start the job's run; whether this call started one. Raises ``QueueUnavailable`` with no payload in it."""
    payload = encode(prepared)
    if not payload.startswith(_ENCRYPTED):
        raise QueueUnavailable("JOB_PAYLOAD_KEK is not set: a job's payload never leaves this tier in plaintext")
    try:
        return ingest_hatchet.trigger(
            prepared.job_id,
            prepared.organization_id,
            prepared.priority,
            payload,
            document_id=document_of(prepared),
            byte_size=original_bytes(prepared),
        )
    except Exception as error:
        # Class name only: the payload and its error carry presigned URLs.
        raise QueueUnavailable(
            f"could not hand ingestion job {prepared.job_id} to Hatchet: {type(error).__name__}"
        ) from error


def document_of(prepared: PreparedIngestJob) -> str | None:
    """The one document the job indexes, which a later upload of it supersedes; None for any other job.

    ``POST /v1/ingest`` hands over one ``file_ref`` of one document, and a corpus
    job one file with no document id. A job of several files is not one
    document's, so it is keyed on its own id and supersedes nothing.
    """
    document_id = prepared.config.get("document_id")
    if len(prepared.file_paths) != 1 or not isinstance(document_id, str) or not document_id:
        return None
    return document_id


def original_bytes(prepared: PreparedIngestJob) -> int | None:
    """The original's size as the BFF stated it (``byte_size``), which picks the workflow; None when unstated."""
    size = prepared.config.get("original_bytes")
    return size if isinstance(size, int) and not isinstance(size, bool) and size >= 0 else None


def dispatch(ingestor: BaseIngestor, prepared: PreparedIngestJob) -> None:
    """Hand a PENDING job to Hatchet, or to this process when it cannot go there."""
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
    """Hand a PENDING job to Hatchet, and never run it here; whether this call started its run.

    For work that must run on an ingest worker or not at all (the base corpus):
    unlike :func:`dispatch` there is no fallback to this process's own pool when
    the job cannot run elsewhere or Hatchet cannot take it. Each raises
    :class:`QueueUnavailable`, with a message that carries no payload (it holds
    URLs). A job whose run is already live is not started again (False).
    """
    if prepared.status.status != JobState.PENDING:
        raise QueueUnavailable(f"ingestion job {prepared.job_id} was not accepted: {prepared.status.error_message}")
    if not durable(prepared):
        raise QueueUnavailable(f"ingestion job {prepared.job_id} cannot run in another process")
    return _hand_over(prepared)


# ------------------------------------------------------------------ cancel

#: How a cancel ended, as :func:`cancel` reports it.
CANCEL_STOPPED = "cancelled"
CANCEL_FINISHED = "finished"
CANCEL_UNAVAILABLE = "unavailable"


def cancel(job_id: str) -> str:
    """Stop a waiting or running ingestion job; what happened.

    The job's status settles ``cancelled`` and its Hatchet run is cancelled by
    id: a waiting run never starts, a running one stops at its next ownership
    check before it reads or writes, and settles its status the same way.

    Returns ``CANCEL_STOPPED`` when a live job was stopped, ``CANCEL_FINISHED``
    when its status is no longer live (done, or never known), and
    ``CANCEL_UNAVAILABLE`` when the job has no run to cancel (it runs in the
    pool of a process this one cannot reach) or Hatchet could not be reached.
    """
    status = ingest_status_store.get(job_id)
    if status is None or status.status not in (JobState.PENDING, JobState.PROCESSING):
        return CANCEL_FINISHED
    run_id = ingest_run_hold.run_id_of(job_id)
    if run_id is None:
        return CANCEL_UNAVAILABLE
    # Before the cancel: the run that sees it must know a person asked, not a newer upload.
    ingest_run_hold.mark_stopped_by_person(job_id)
    try:
        ingest_hatchet.cancel_run(run_id)
    except Exception as error:  # noqa: BLE001 - the route reports it; the job runs on
        logger.warning("Could not cancel the run of ingestion job %s: %s", job_id, type(error).__name__)
        return CANCEL_UNAVAILABLE
    ingest_status_store.settle_cancelled(job_id)
    return CANCEL_STOPPED


def stamp_queue_ahead(statuses: dict[str, Any]) -> None:
    """Clear ``metadata.queue_ahead`` on each waiting job: Hatchet does not count a lane's waiting runs.

    The key stays, ``None``, so a reader that showed a count from the claim
    queue's days clears it rather than keeping the last one.
    """
    for status in statuses.values():
        if status and status.get("status") == JobState.PENDING.value:
            status.setdefault("metadata", {})["queue_ahead"] = None
