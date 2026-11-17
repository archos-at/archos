import itertools
import logging
import os
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from agent.knowledge import ingest_status_store
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent.knowledge.schema import stable_file_id

from . import limits

logger = logging.getLogger(__name__)

_LIVE = (JobState.PENDING, JobState.PROCESSING)


class _ClaimLost(Exception):  # noqa: N818 - a signal, not an error
    ...


def _parse_timestamp(iso_string: str | None) -> datetime | None:
    if not iso_string:
        return None
    try:
        return datetime.fromisoformat(iso_string)
    except ValueError, TypeError:
        return None


def _existing_paths(
    file_paths: list[str | Callable[[], str]], original_filenames: list[str]
) -> tuple[list[str | Callable[[], str]], list[str], list[int]]:
    from knowledge_layer.ingest.deferred_files import is_deferred

    validated_paths = []
    aligned_filenames = []
    kept_indices: list[int] = []
    for idx, path in enumerate(file_paths):
        if not (is_deferred(path) or os.path.exists(path)):
            logger.warning(f"File not found, skipping: {path}")
            continue
        validated_paths.append(path)
        kept_indices.append(idx)
        if idx < len(original_filenames):
            aligned_filenames.append(original_filenames[idx])
    return validated_paths, aligned_filenames, kept_indices


def _file_progress(
    collection_name: str, validated_paths: list[str | Callable[[], str]], original_filenames: list[str]
) -> list[FileProgress]:
    from knowledge_layer.ingest.deferred_files import is_deferred

    file_details = []
    for i, p in enumerate(validated_paths):
        if i < len(original_filenames):
            file_name = original_filenames[i]
        else:
            file_name = "document" if is_deferred(p) else Path(p).name
        file_details.append(
            FileProgress(
                file_id=stable_file_id(collection_name, file_name),
                file_name=file_name,
                status=FileStatus.UPLOADING,
                progress_percent=0.0,
            )
        )
    return file_details


def _settle_file(file_detail: FileProgress, status: FileStatus, chunks_created: int | None, error: str | None, exc):
    from agent.knowledge.ingest_failures import classify_failure

    file_detail.status = status
    file_detail.progress_percent = 100.0

    if status == FileStatus.SUCCESS and chunks_created is not None:
        file_detail.chunks_created = chunks_created
    elif status == FileStatus.FAILED and error:
        file_detail.error_message = error
    if status == FileStatus.FAILED:
        verdict = classify_failure(error, exc)
        file_detail.failure_category = verdict.category
        file_detail.retryable = verdict.retryable
    else:
        file_detail.failure_category = None
        file_detail.retryable = None


def _is_stale(job: IngestionJobStatus, now: datetime) -> bool:
    if job.status not in (JobState.COMPLETED, JobState.FAILED):
        return False
    completed_at = _parse_timestamp(job.completed_at) if isinstance(job.completed_at, str) else None
    return completed_at is not None and (now - completed_at).total_seconds() > limits.JOB_RETENTION_SECONDS


class JobTracking:
    def _start_ingest_heartbeat(self) -> None:
        threading.Thread(target=self._heartbeat_loop, daemon=True, name="llamaindex-ingest-heartbeat").start()

    def _heartbeat_loop(self) -> None:
        self._settle_stranded_jobs()
        ingest_status_store.prune_expired(limits.FILE_TRACKING_RETENTION_SECONDS)
        for beats in itertools.count(1):
            time.sleep(ingest_status_store.HEARTBEAT_INTERVAL_SECONDS)
            self._beat()
            if beats % limits.PRUNE_EVERY_BEATS == 0:
                ingest_status_store.prune_expired(limits.FILE_TRACKING_RETENTION_SECONDS)

    @staticmethod
    def _settle_stranded_jobs() -> None:
        settled = ingest_status_store.fail_interrupted()
        if settled:
            logger.warning("Settled %d ingest job(s) a previous process left unfinished as interrupted", settled)

    def _beat(self) -> None:
        live = self._live_job_ids()
        refreshed = ingest_status_store.heartbeat(live)
        if refreshed is not None and refreshed < len(live):
            logger.warning("Heartbeat refreshed %d of %d live ingest job(s); re-writing them", refreshed, len(live))
            with self._persist_lock:
                self._unpersisted.update(live)
        self._retry_unpersisted()

    def _persist(self, job: IngestionJobStatus) -> None:
        with self._persist_lock:
            with self._lock:
                snapshot = job.model_copy(deep=True)
            stopped = snapshot.status != JobState.COMPLETED and self._told_to_stop(job.job_id)
            if stopped or ingest_status_store.put(snapshot):
                self._unpersisted.discard(job.job_id)
            else:
                self._unpersisted.add(job.job_id)

    def _retry_unpersisted(self) -> None:
        with self._persist_lock:
            pending = list(self._unpersisted)
        if not pending:
            return
        self._prune_completed_jobs()
        with self._lock:
            jobs = {jid: self._jobs.get(jid) for jid in pending}
        for jid, job in jobs.items():
            if job is not None:
                self._persist(job)
                continue
            with self._persist_lock:
                self._unpersisted.discard(jid)

    def _live_job_ids(self) -> list[str]:
        with self._lock:
            return [jid for jid, job in self._jobs.items() if job.status in _LIVE]

    def find_live_job(self, dispatch_key: str) -> str | None:
        if not dispatch_key:
            return None
        with self._lock:
            local = next(
                (
                    jid
                    for jid, job in self._jobs.items()
                    if job.status in _LIVE and job.metadata.get("dispatch_key") == dispatch_key
                ),
                None,
            )
        if local is not None:
            return local
        shared = ingest_status_store.find_live(dispatch_key)
        return shared.job_id if shared is not None else None

    def _record_file_counts(self, job: IngestionJobStatus, file_index: int, **counts: int) -> None:
        with self._lock:
            if file_index < len(job.file_details):
                job.file_details[file_index].metadata.update(counts)

    def _update_file_status(
        self,
        job: IngestionJobStatus,
        file_index: int,
        status: FileStatus,
        chunks_created: int | None = None,
        error: str | None = None,
        exc: BaseException | None = None,
    ) -> None:
        with self._lock:
            if file_index < len(job.file_details):
                _settle_file(job.file_details[file_index], status, chunks_created, error, exc)
            job.processed_files = file_index + 1

        self._persist(job)

    def _record_failed_pages(self, job: IngestionJobStatus, file_index: int, text_pages: list) -> None:
        failed = len(getattr(text_pages, "failed_pages", ()))
        if not failed:
            return
        with self._lock:
            if file_index < len(job.file_details):
                job.file_details[file_index].pages_failed = failed
        logger.warning(
            "Indexed %s without %d unreadable page(s): %s",
            job.file_details[file_index].file_name if file_index < len(job.file_details) else "file",
            failed,
            text_pages.failed_pages,
        )

    def submit_job(
        self,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any] | None = None,
    ) -> str:
        prepared = self.prepare_job(file_paths, collection_name, config)
        if prepared.status.status == JobState.PENDING:
            self.submit_prepared(prepared)
        return prepared.job_id

    def prepare_job(
        self,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> PreparedIngestJob:
        from knowledge_layer.ingest.renditions import align_extraction_paths

        job_id = job_id or str(uuid.uuid4())
        job_config = dict(config or {})

        validated_paths, aligned_filenames, kept_indices = _existing_paths(
            file_paths, job_config.get("original_filenames", [])
        )
        job_config["original_filenames"] = aligned_filenames
        align_extraction_paths(job_config, kept_indices)

        if not validated_paths:
            return self._prepared_without_files(job_id, len(file_paths), collection_name, job_config)

        job = IngestionJobStatus(
            job_id=job_id,
            status=JobState.PENDING,
            submitted_at=datetime.utcnow(),
            total_files=len(validated_paths),
            processed_files=0,
            collection_name=collection_name,
            backend=self.backend_name,
            file_details=_file_progress(collection_name, validated_paths, aligned_filenames),
            metadata={
                key: job_config[key] for key in ("dispatch_key", "document_id") if isinstance(job_config.get(key), str)
            },
        )

        if not ingest_status_store.put(job):
            with self._persist_lock:
                self._unstored_at_prepare.add(job_id)
        return PreparedIngestJob(job_id, job, validated_paths, collection_name, job_config)

    def _prepared_without_files(
        self, job_id: str, total_files: int, collection_name: str, job_config: dict[str, Any]
    ) -> PreparedIngestJob:
        job = IngestionJobStatus(
            job_id=job_id,
            status=JobState.FAILED,
            submitted_at=datetime.utcnow(),
            total_files=total_files,
            processed_files=0,
            collection_name=collection_name,
            backend=self.backend_name,
            error_message="No valid file paths provided",
            completed_at=datetime.utcnow().isoformat(),
        )
        with self._lock:
            self._jobs[job_id] = job
        self._persist(job)
        return PreparedIngestJob(job_id, job, [], collection_name, job_config)

    def _adopt(self, prepared: PreparedIngestJob) -> None:
        with self._persist_lock:
            if prepared.job_id in self._unstored_at_prepare:
                self._unstored_at_prepare.discard(prepared.job_id)
                self._unpersisted.add(prepared.job_id)
        with self._lock:
            self._jobs[prepared.job_id] = prepared.status

    def submit_prepared(self, prepared: PreparedIngestJob) -> None:
        self._adopt(prepared)
        try:
            self._ingest_pool.submit(
                self._run_ingestion,
                prepared.job_id,
                prepared.file_paths,
                prepared.collection_name,
                self._job_config(prepared),
            )
        except RuntimeError as error:
            with self._lock:
                job = self._jobs[prepared.job_id]
                job.status = JobState.FAILED
                job.error_message = f"{ingest_status_store.INTERRUPTED}: {error}; retry to index this file"
                job.completed_at = datetime.utcnow().isoformat()
            self._persist(job)
            raise
        logger.info("LlamaIndex ingestion job submitted: %s", prepared.job_id)

    def run_prepared(self, prepared: PreparedIngestJob, still_owner: Callable[[], bool] | None = None) -> None:
        self._adopt(prepared)
        if still_owner is not None:
            self._claim_guards[prepared.job_id] = still_owner
        try:
            self._run_ingestion(
                prepared.job_id, prepared.file_paths, prepared.collection_name, self._job_config(prepared)
            )
        finally:
            self._claim_guards.pop(prepared.job_id, None)

    def _told_to_stop(self, job_id: str) -> bool:
        guard = self._claim_guards.get(job_id)
        return guard is not None and not guard()

    def _assert_still_owner(self, job_id: str) -> None:
        if self._told_to_stop(job_id):
            raise _ClaimLost(job_id)

    def _abandon(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)
        logger.warning("Ingestion job %s was stopped; this run ends without writing", job_id)

    def _job_config(self, prepared: PreparedIngestJob) -> dict[str, Any]:
        return {**self.config, **prepared.config}

    def _prune_completed_jobs(self) -> None:
        now = datetime.utcnow()
        with self._lock:
            stale = [jid for jid, job in self._jobs.items() if _is_stale(job, now)]
            for jid in stale:
                del self._jobs[jid]
        if stale:
            logger.debug("Pruned %d completed job(s) from tracking", len(stale))

    def get_job_status(self, job_id: str) -> IngestionJobStatus | None:
        self._prune_completed_jobs()
        with self._lock:
            local = self._jobs.get(job_id)
        if local is not None:
            return local.model_copy()
        return ingest_status_store.get(job_id)

    def _parse_timestamp(self, iso_string: str | None) -> datetime | None:
        return _parse_timestamp(iso_string)
