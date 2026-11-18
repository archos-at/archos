import logging
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime
from typing import Any

from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import JobState

from . import collection_catalog
from . import limits
from . import vision_credentials
from .document_reading import _future_result
from .job_tracking import _ClaimLost

logger = logging.getLogger(__name__)


@dataclass
class JobRun:
    job_id: str
    job: Any
    file_paths: list[str | Callable[[], str]]
    collection_name: str
    config: dict[str, Any]
    downloaded: list[str]
    chunk_size: int
    chunk_overlap: int
    extract_tables: bool
    extract_images: bool
    extract_charts: bool
    organization_id: str | None
    vlm_api_key: str | None
    vlm_base_url: str
    vlm_model: str
    ocr_model: str
    identity: dict[str, str]
    screening_rules: Any
    screening_unusable: bool
    kept_previous: list[str] = field(default_factory=list)
    total_chunks: int = 0
    total_tables: int = 0
    total_charts: int = 0
    total_images: int = 0

    @property
    def vision(self) -> dict[str, Any]:
        return {"vlm_model": self.vlm_model, "vlm_base_url": self.vlm_base_url, "vlm_api_key": self.vlm_api_key}

    def extraction_mode(self) -> str:
        multimodal = self.extract_tables or self.extract_charts or self.extract_images
        return "multimodal" if multimodal else "text-only"


def _ingest_cost_scope(job_id: str, config: dict[str, Any]):
    from agent.common.cost_tracking import USAGE_ACTIVITY_INGEST
    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs

    return track_llm_costs(
        job_id=job_id,
        identity={
            "organization_id": config.get("organization_id"),
            "user_id": config.get("user_id"),
            "project_id": config.get("project_id"),
            "conversation_id": None,
            "message_id": None,
        },
        budget=BudgetSnapshot(),
        activity=USAGE_ACTIVITY_INGEST,
    )


def _clean_up_files(file_paths: list[str | Callable[[], str]], config: dict[str, Any]) -> None:
    from knowledge_layer.ingest.renditions import handed_rendition_paths

    handed = [path for path in file_paths if isinstance(path, str)]
    for file_path in [*handed, *handed_rendition_paths(config)]:
        _remove_temp_file(file_path)


def _remove_temp_file(file_path: str) -> None:
    try:
        if os.path.exists(file_path):
            os.unlink(file_path)
            logger.debug(f"Cleaned up temp file: {file_path}")
    except OSError as e:
        logger.warning(f"Failed to clean up temp file {file_path}: {e}")


class IngestRun:
    def _embedded_records(
        self, documents: list[Any], *, chunk_size: int, chunk_overlap: int, version: Any = None
    ) -> list[Any]:
        from knowledge_layer.embedding import EMBED_FINGERPRINT_KEY

        from .chunk_identity import embedded_records

        return embedded_records(
            documents,
            self._embed_model,
            fingerprint=self._embed_fingerprint_metadata()[EMBED_FINGERPRINT_KEY],
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            version=version,
        )

    @staticmethod
    def _deleted_while_indexing(config: dict[str, Any], collection_name: str) -> bool:
        document_id = config.get("document_id")
        if not document_id:
            return False
        from knowledge_layer.ingest import document_presence

        answer = document_presence.document_still_exists(
            str(document_id), collection_name, config.get("organization_id")
        )
        return answer is False

    def _remember_permit(
        self,
        config: dict[str, Any],
        collection_name: str,
        file_name: str,
        tags: list[str] | None,
        text_documents: list[Any],
    ) -> None:
        from agent.knowledge.permit_extraction import extract_and_store_permit_record
        from agent.knowledge.permit_extraction import is_permit_decision
        from agent.knowledge.permit_extraction import typed_as_something_else
        from agent.knowledge.permit_records_client import store_permit_record

        organization_id, document_id = config.get("organization_id"), config.get("document_id")
        if not (organization_id and document_id):
            return
        if not is_permit_decision(tags):
            if typed_as_something_else(tags):
                self._bounded(
                    "Permit record drop",
                    file_name,
                    limits.PERMIT_RECORD_DROP_TIMEOUT_SECONDS,
                    store_permit_record,
                    str(organization_id),
                    str(document_id),
                    collection_name,
                    file_name,
                    "",
                    None,
                )
            return
        if not (self.generate_summary_enabled and self.summary_llm):
            return
        pages = [(doc.metadata.get("page_label"), doc.get_content()) for doc in text_documents]
        self._bounded(
            "Permit record",
            file_name,
            limits.PERMIT_RECORD_TIMEOUT_SECONDS,
            extract_and_store_permit_record,
            pages,
            self.summary_llm,
            organization_id=str(organization_id),
            document_id=str(document_id),
            collection=collection_name,
            file_name=file_name,
        )

    @staticmethod
    def _bounded(label: str, name: str, timeout: float, work: Callable[..., Any], /, *args: Any, **kwargs: Any) -> None:
        from agent.common.cost_tracking import submit_in_context

        pool = ThreadPoolExecutor(max_workers=1)
        try:
            _future_result(submit_in_context(pool, work, *args, **kwargs), label, name, timeout=timeout)
        finally:
            pool.shutdown(wait=False)

    def _run_ingestion(
        self,
        job_id: str,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any],
    ):
        from agent.common.openrouter import ZERO_DATA_RETENTION
        from agent.common.openrouter import data_policy_for
        from agent.common.openrouter import data_policy_scope
        from agent.common.provider_limiter import priority_scope

        organization_id = config.get("organization_id")
        policy = data_policy_for(organization_id) if organization_id else ZERO_DATA_RETENTION
        with (
            data_policy_scope(policy),
            _ingest_cost_scope(job_id, config),
            priority_scope(config.get("priority")),
        ):
            self._ingest_job(job_id, file_paths, collection_name, config)

    def _ingest_job(
        self,
        job_id: str,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any],
    ):
        from knowledge_layer.ingest.renditions import delete_quietly

        downloaded: list[str] = []
        try:
            run = self._start_job(job_id, file_paths, collection_name, config, downloaded)
            for i, file_entry in enumerate(file_paths):
                self._ingest_file(run, i, file_entry)
            self._finish_job(run)

        except _ClaimLost:
            self._abandon(job_id)

        except Exception as e:
            logger.exception("LlamaIndex ingestion failed")
            with self._lock:
                job = self._jobs[job_id]
                job.status = JobState.FAILED
                job.completed_at = datetime.utcnow().isoformat()
                job.error_message = str(e)
            self._persist(job)

        finally:
            if config.get("cleanup_files", False):
                _clean_up_files(file_paths, config)
            delete_quietly(downloaded)

    def _start_job(
        self,
        job_id: str,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any],
        downloaded: list[str],
    ) -> JobRun:
        from agent.common.content_screen import screening_config_unusable
        from knowledge_layer.ingest import transcription as _transcription
        from knowledge_layer.ingest.reader_version import INGEST_READER_VERSION
        from knowledge_layer.ingest.screening import ScreeningRules
        from knowledge_layer.vector_store import get_store

        with self._lock:
            job = self._jobs[job_id]
            job.status = JobState.PROCESSING
            job.started_at = datetime.utcnow()
            job.reader_version = INGEST_READER_VERSION
        self._persist(job)

        self._ensure_initialized()

        organization_id = config.get("organization_id")
        vlm_cred = vision_credentials.resolve_vlm_credential(organization_id)
        base_vlm_model = config.get("vlm_model", self.vlm_model)
        vlm_override = vision_credentials._resolve_vlm_model_override(organization_id)

        identity = self._embed_fingerprint_metadata()
        get_store(identity).check_identity(collection_name)

        return JobRun(
            job_id=job_id,
            job=job,
            file_paths=file_paths,
            collection_name=collection_name,
            config=config,
            downloaded=downloaded,
            chunk_size=config.get("chunk_size", self.chunk_size),
            chunk_overlap=config.get("chunk_overlap", self.chunk_overlap),
            extract_tables=config.get("extract_tables", self.extract_tables),
            extract_images=config.get("extract_images", self.extract_images),
            extract_charts=config.get("extract_charts", self.extract_charts),
            organization_id=organization_id,
            vlm_api_key=vlm_cred.api_key,
            vlm_base_url=config.get("vlm_base_url") or vlm_cred.base_url,
            vlm_model=vlm_override or base_vlm_model,
            ocr_model=_transcription.resolve_ocr_model(base_vlm_model, vlm_override),
            identity=identity,
            screening_rules=ScreeningRules.from_config(config.get("screening")),
            screening_unusable=screening_config_unusable(config.get("screening")),
        )

    def _reconcile_summaries(self, collection_name: str, file_names: list[str]) -> None:
        try:
            from agent.knowledge.factory import reconcile_collection_summaries

            reconcile_collection_summaries(self, collection_name, file_names=file_names)
        except Exception as e:
            logger.warning("Reconciliation failed for collection %s: %s", collection_name, e)

    def _finish_job(self, run: JobRun) -> None:
        job, collection_name = run.job, run.collection_name
        for name in run.kept_previous:
            logger.warning("Kept the previous version of %s in %s: its re-upload did not index", name, collection_name)

        failed_files = [f for f in job.file_details if f.status == FileStatus.FAILED]
        successful_files = [f for f in job.file_details if f.status == FileStatus.SUCCESS]

        if successful_files:
            self._reconcile_summaries(collection_name, [f.file_name for f in successful_files])

        with self._lock:
            if failed_files and not successful_files:
                job.status = JobState.FAILED
                job.error_message = f"{len(failed_files)}/{len(job.file_details)} file(s) failed"
            else:
                job.status = JobState.COMPLETED
            job.completed_at = datetime.utcnow().isoformat()
            job.metadata = {
                **job.metadata,
                "total_chunks": run.total_chunks,
                "text_chunks": run.total_chunks - run.total_tables - run.total_charts - run.total_images,
                "tables_extracted": run.total_tables,
                "charts_extracted": run.total_charts,
                "images_captioned": run.total_images,
                "collection_name": collection_name,
                "embed_model": self.embed_model_name,
                "extraction_mode": run.extraction_mode(),
            }

        self._persist(job)

        collection_catalog.bump_collection_version(collection_name)

        logger.info(
            f"LlamaIndex ingestion completed: {run.job_id} "
            f"(chunks={run.total_chunks}, tables={run.total_tables}, "
            f"charts={run.total_charts}, images={run.total_images})"
        )
