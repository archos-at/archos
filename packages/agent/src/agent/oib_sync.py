from __future__ import annotations

import hashlib
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import replace
from enum import StrEnum
from typing import Any

from agent import corpus_store
from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge.factory import get_ingestor
from agent.knowledge.factory import unregister_summary
from agent.knowledge.leader_lock import keyed_lock
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import JobState

logger = logging.getLogger(__name__)

EnqueueIngestJob = Callable[[Any], bool]

COLLECTION_NAME = os.environ.get("OIB_COLLECTION_NAME") or os.environ.get("COLLECTION_NAME") or "oib_knowledge"

SYNC_LOCK_KEY = "oib-sync"

CHUNK_FORMAT_VERSION = 5


@dataclass(frozen=True)
class SyncResult:

    enqueued: int
    ingested_recorded: int
    failed: int
    total: int


class JobProgress(StrEnum):

    NONE = "none"
    """No job for these bytes and this pipeline version: one may be queued."""

    WAITING = "waiting"
    """Queued, or running its first moments: a worker has it or will."""

    RUNNING = "running"
    DONE = "done"
    """Finished and indexed; the cycle has yet to record it."""

    FAILED = "failed"
    """Ran and gave up (or lost every claim): not queued again until the bytes change or an admin asks."""


@dataclass(frozen=True)
class Settled:

    rows: dict[str, corpus_store.FileRow]
    progress: dict[str, JobProgress]
    recorded: int


def job_id_for(row: corpus_store.FileRow) -> str:
    digest = hashlib.sha256(f"{row.file_name}\0{row.sha256}\0{CHUNK_FORMAT_VERSION}".encode()).hexdigest()
    return f"oib-{digest[:32]}"


def _file_lock(name: str):
    return keyed_lock(f"oib-file:{name}")


def _ensure_collection(ingestor) -> None:
    if ingestor.get_collection(COLLECTION_NAME) is not None:
        logger.info("Collection %s already exists", COLLECTION_NAME)
        return

    try:
        ingestor.create_collection(
            COLLECTION_NAME,
            description="Persistent OIB Richtlinien knowledge base.",
        )
        logger.info("Created collection %s", COLLECTION_NAME)
    except Exception as e:
        if ingestor.get_collection(COLLECTION_NAME) is None:
            raise
        logger.info("Collection %s already exists (create raised: %s)", COLLECTION_NAME, e)


def _collection_is_empty(ingestor) -> bool:
    try:
        info = ingestor.get_collection(COLLECTION_NAME)
    except Exception as exc:
        logger.debug("Could not probe collection %s: %s", COLLECTION_NAME, exc)
        return False
    if info is None:
        return True
    return getattr(info, "chunk_count", None) == 0 or getattr(info, "file_count", None) == 0


def _get_oib_ingestor():
    import knowledge_layer.ingest.adapter  # noqa: F401

    return get_ingestor("llamaindex")


def _indexed_names(ingestor) -> set[str]:
    if ingestor.get_collection(COLLECTION_NAME) is None:
        return set()
    return {info.file_name for info in ingestor.list_files(COLLECTION_NAME)}




def progress_of(row: corpus_store.FileRow) -> JobProgress:
    job_id = job_id_for(row)
    if row.failed_job_id == job_id:
        return JobProgress.FAILED
    status = ingest_status_store.get(job_id)
    if status is None:
        return JobProgress.NONE
    if status.status == JobState.PENDING:
        return JobProgress.WAITING
    if status.status == JobState.PROCESSING:
        return JobProgress.RUNNING
    done = status.status == JobState.COMPLETED and any(f.status == FileStatus.SUCCESS for f in status.file_details)
    return JobProgress.DONE if done else JobProgress.FAILED


def settle(rows: dict[str, corpus_store.FileRow]) -> Settled:
    settled: dict[str, corpus_store.FileRow] = {}
    progress: dict[str, JobProgress] = {}
    recorded = 0
    for name, row in rows.items():
        settled[name] = row
        if not row.needs_ingestion(CHUNK_FORMAT_VERSION):
            continue
        state = progress_of(row)
        if state == JobProgress.DONE and not row.job_carries_the_mark():
            _drop_job(row)
            state = JobProgress.NONE
        elif state == JobProgress.DONE:
            if corpus_store.mark_ingested(name, row.sha256, CHUNK_FORMAT_VERSION):
                settled[name] = replace(
                    row, ingested_sha256=row.sha256, chunk_format_version=CHUNK_FORMAT_VERSION, failed_job_id=None
                )
                recorded += 1
                continue
            state = JobProgress.WAITING  # the bytes changed or a mark landed under it; the next cycle looks again
        elif state == JobProgress.FAILED and row.failed_job_id != job_id_for(row):
            corpus_store.mark_failed(name, row.sha256, job_id_for(row))
            settled[name] = replace(row, failed_job_id=job_id_for(row))
        progress[name] = state
    return Settled(settled, progress, recorded)


def _drop_job(row: corpus_store.FileRow) -> None:
    job_id = job_id_for(row)
    run_id = ingest_run_hold.run_id_of(job_id)
    ingest_status_store.delete(job_id)
    if run_id is not None:
        _cancel_run(job_id, run_id)


def _cancel_run(job_id: str, run_id: str) -> None:
    from agent.knowledge import ingest_workflow

    try:
        ingest_workflow.cancel_run(run_id)
    except Exception as error:  # noqa: BLE001 - the status is gone; a run that still starts finds no row to resume
        logger.warning("Could not cancel the run of corpus job %s: %s", job_id, type(error).__name__)


def _request_locked(name: str, doc_class: str | None, enqueue: EnqueueIngestJob) -> bool:
    row = corpus_store.get_file(name)
    if row is None:
        raise LookupError(f"{name} is no longer in the base corpus")
    if not row.needs_ingestion(CHUNK_FORMAT_VERSION) or progress_of(row) != JobProgress.NONE:
        return False

    ingestor = _get_oib_ingestor()
    _ensure_collection(ingestor)
    config: dict = {"cleanup_files": True, "original_filenames": [name], "priority": "bulk"}
    if doc_class:
        config["doc_class"] = doc_class
    mark = corpus_store.begin_job(name)
    if mark is not None:
        config.update(mark.job_config())
    prepared = ingestor.prepare_job(
        [corpus_store.CorpusObjectDownload(row.storage_key, row.sha256)],
        COLLECTION_NAME,
        config,
        job_id=job_id_for(row),
    )
    try:
        queued = enqueue(prepared)
    except Exception:
        ingest_status_store.delete(prepared.job_id)
        raise
    if queued:
        logger.info("Queued the ingestion of %s as job %s", name, prepared.job_id)
    return queued


def request_ingestion(name: str, doc_class: str | None = None, *, enqueue: EnqueueIngestJob) -> bool:
    with _file_lock(name):
        return _request_locked(name, doc_class, enqueue)


def store_and_request(name: str, data: bytes, doc_class: str | None = None, *, enqueue: EnqueueIngestJob) -> bool:
    with _file_lock(name):
        held = corpus_store.get_file(name)
        if held is None:
            corpus_store.put(name, data)
        elif held.sha256 != hashlib.sha256(data).hexdigest():
            raise corpus_store.CorpusFileImmutable(name)
        return _request_locked(name, doc_class, enqueue)




def remove_document(name: str) -> bool:
    if not corpus_store.is_valid_name(name):
        return False
    with _file_lock(name):
        ingestor = _get_oib_ingestor()
        row = corpus_store.get_file(name)
        if row is None and name not in _indexed_names(ingestor):
            return False

        if row is not None:
            _drop_job(row)
        ingestor.delete_file(name, COLLECTION_NAME)
        unregister_summary(COLLECTION_NAME, name)
        corpus_store.remove(name)
    logger.info("Removed OIB document %s", name)
    return True


def mark_for_reingest(name: str, mark: corpus_store.FileMark | None = None) -> bool:
    if not corpus_store.is_valid_name(name):
        return False
    with _file_lock(name):
        row = corpus_store.get_file(name)
        if row is None:
            return False
        in_flight = progress_of(row) in (JobProgress.WAITING, JobProgress.RUNNING)
        if not in_flight:
            _drop_job(row)
        if mark is not None and not (in_flight and corpus_store.get_mark(name) == mark):
            corpus_store.set_mark(name, mark)
        corpus_store.forget_ingested(name)
    return True




IMPORT_PENDING_ENV = "VECTOR_IMPORT_PENDING"


def _forget_everything_if_the_index_was_reset(rows: dict[str, corpus_store.FileRow]) -> dict[str, corpus_store.FileRow]:
    if not any(row.ingested_sha256 for row in rows.values()) or not _collection_is_empty(_get_oib_ingestor()):
        return rows
    if os.environ.get(IMPORT_PENDING_ENV, "").strip().lower() in ("1", "true", "yes"):
        logger.warning(
            "OIB sync: collection %s is empty while the table lists ingested files, and %s is set: "
            "an import is pending, so nothing is re-ingested. Unset it once the import has verified",
            COLLECTION_NAME,
            IMPORT_PENDING_ENV,
        )
        return rows
    logger.warning(
        "OIB sync: the table lists ingested files but collection %s is empty/missing "
        "(vector store reset or repointed) — forcing a full re-ingest",
        COLLECTION_NAME,
    )
    for row in rows.values():
        if progress_of(row) not in (JobProgress.WAITING, JobProgress.RUNNING):
            _drop_job(row)
    corpus_store.forget_ingested()
    return corpus_store.list_files()


MarkCorpusChunks = Callable[[dict[str, dict[str, str | bool]]], None]


def backfill_legacy_marks(mark_chunks: MarkCorpusChunks | None) -> int:
    if mark_chunks is None:
        return 0
    names = corpus_store.legacy_unmarked()
    try:
        if names:
            mark_chunks({name: {"country_id": corpus_store.LEGACY_CORPUS_COUNTRY, "released": True} for name in names})
    except Exception:  # noqa: BLE001 - the next cycle tries again; nothing below has run
        logger.warning(
            "The legacy country backfill could not reach the vector store; it runs next cycle", exc_info=True
        )
        return 0
    mark = corpus_store.FileMark(country_id=corpus_store.LEGACY_CORPUS_COUNTRY, released=True)
    for name in names:
        corpus_store.set_mark(name, mark)
    corpus_store.record_legacy_backfill()
    if names:
        logger.info("Marked %d base-corpus file(s) from before the country field as %s", len(names), mark.country_id)
    return len(names)


def sync(*, enqueue: EnqueueIngestJob, mark_chunks: MarkCorpusChunks | None = None) -> SyncResult:
    with keyed_lock(SYNC_LOCK_KEY):
        backfill_legacy_marks(mark_chunks)
        rows = _forget_everything_if_the_index_was_reset(corpus_store.list_files())
        settled = settle(rows)
        failed = sum(1 for state in settled.progress.values() if state == JobProgress.FAILED)
        enqueued = 0
        for name in sorted(n for n, state in settled.progress.items() if state == JobProgress.NONE):
            try:
                enqueued += request_ingestion(name, enqueue=enqueue)
            except LookupError:
                logger.info("%s left the corpus before its job was queued", name)
        result = SyncResult(
            enqueued=enqueued, ingested_recorded=settled.recorded, failed=failed, total=len(settled.rows)
        )
        logger.info("OIB sync: %s", result)
        return result
