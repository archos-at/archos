import contextlib
import logging
import os
import time
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

from agent.knowledge.schema import FileStatus

from . import filed_mail
from . import memory_use
from .chunk_metadata import provenance_from_config
from .chunk_metadata import stamp_chunk_metadata
from .file_sniffing import _looks_like_pdf
from .file_sniffing import _looks_like_raw_pdf_or_binary
from .ingest_run import JobRun
from .job_tracking import _ClaimLost
from .measures import _log_ingest_perf
from .measures import _stage
from .measures import file_trace as _file_trace
from .measures import finish_file as _finish_file_trace
from .stored_names import _normalized_file_name
from .stored_names import _replacement_lock_key

logger = logging.getLogger(__name__)

DOCUMENT_DELETED_DURING_INGEST = "document_deleted: the document was deleted while it was being ingested"
SCREENING_UNAVAILABLE = (
    "screening_unavailable: the screening policy in this job could not be applied; nothing of the file was read"
)
NO_CONTENT_EXTRACTED = "No content extracted (file may be password-protected, corrupted, or empty)"


@dataclass
class FileRun:
    index: int
    file_path: str
    file_name: str
    rendition: str | None
    started: float
    scope: contextlib.ExitStack = field(default_factory=contextlib.ExitStack)
    stages: dict[str, float] = field(default_factory=dict)
    file_size: int = 0
    previous: Any = None
    retired: bool = False
    deleted: bool = False
    attempted: list[str] | None = None
    coverage: Any = None
    photo: Any = None
    preserved: dict[str, str] = field(default_factory=dict)
    row_doc_class: str | None = None
    stored_doc_class: str | None = None
    explicit_doc_class: str | None = None
    doc_class: str | None = None
    base_corpus: bool = False
    is_pdf: bool = False
    is_image: bool = False
    image_format: str | None = None

    @property
    def source_path(self) -> str:
        return self.rendition or self.file_path

    @property
    def keeps_previous(self) -> bool:
        return self.previous is not None and not self.retired and not self.deleted


@dataclass
class Extracted:
    text_documents: list[Any]
    all_documents: list[Any]
    drawing_pages: list[dict[str, Any]] = field(default_factory=list)


def text_extracted(text_documents: list[Any]) -> list[Any]:
    logger.info(f"  Text extraction: {len(text_documents)} documents")
    return list(text_documents)


class FileIngest:
    def _skipped_before_reading(self, run: JobRun, i: int) -> bool:
        if self._deleted_while_indexing(run.config, run.collection_name):
            self._update_file_status(run.job, i, FileStatus.FAILED, error=DOCUMENT_DELETED_DURING_INGEST)
            logger.info("Skipped file %d of job %s: its document was deleted before it was read", i + 1, run.job_id)
            return True
        if run.screening_unusable:
            self._update_file_status(run.job, i, FileStatus.FAILED, error=SCREENING_UNAVAILABLE)
            logger.warning("Held file %d of job %s: its screening policy could not be applied", i + 1, run.job_id)
            return True
        return False

    def _ingest_file(self, run: JobRun, i: int, file_entry: Any) -> None:
        from knowledge_layer.ingest.deferred_files import ORIGINAL_DOWNLOAD_FAILED
        from knowledge_layer.ingest.deferred_files import resolve_original
        from knowledge_layer.ingest.renditions import resolve_rendition

        self._assert_still_owner(run.job_id)
        if self._skipped_before_reading(run, i):
            return
        file_path = resolve_original(file_entry, run.downloaded)
        if file_path is None:
            self._update_file_status(run.job, i, FileStatus.FAILED, error=ORIGINAL_DOWNLOAD_FAILED)
            return
        original_filenames = run.config.get("original_filenames", [])
        file_name = original_filenames[i] if i < len(original_filenames) else Path(file_path).name
        file = FileRun(index=i, file_path=file_path, file_name=file_name, rendition=None, started=time.monotonic())
        memory_use._log_memory(f"file:start {file_name}")
        file.rendition = resolve_rendition(run.config, i, run.downloaded)
        trace = _file_trace(file_name, run.config, run.job_id)
        recorder = trace.__enter__()
        try:
            self._read_and_index(run, file)
        except _ClaimLost:
            raise
        except Exception as e:
            logger.exception(f"Error processing file {file_path}")
            self._update_file_status(run.job, i, FileStatus.FAILED, error=str(e), exc=e)
            self._discard_partial_version(run.collection_name, file_name, file.attempted, file.previous)
        finally:
            self._close_file(run, file, trace, recorder)

    def _close_file(self, run: JobRun, file: FileRun, trace: Any, recorder: Any) -> None:
        _log_ingest_perf(file.file_name, file.stages)
        _finish_file_trace(recorder, run.job, file.index, file.stages, file.coverage)
        trace.__exit__(None, None, None)
        memory_use._release_memory(file.file_name)
        if file.keeps_previous and self._quarantined(run.job, file.index):
            self._retire_held_predecessor(run.collection_name, file.file_name, file.previous)
            file.retired = True
        file.scope.close()
        if file.keeps_previous:
            run.kept_previous.append(file.file_name)

    def _read_and_index(self, run: JobRun, file: FileRun) -> None:
        file.file_size = os.path.getsize(file.file_path)
        self._take_previous_version(run, file)
        self._classify_file(run, file)
        extracted = self._extract(run, file)
        if extracted is not None:
            self._index_documents(run, file, extracted)

    def _take_previous_version(self, run: JobRun, file: FileRun) -> None:
        from agent.common.norm_registry import guess_doc_class
        from agent.common.source_kinds import legacy_shelf_for_collection_name
        from agent.knowledge import get_document_doc_class
        from agent.knowledge.document_classification import canonical_doc_class
        from agent.knowledge.leader_lock import keyed_lock

        collection_name, file_name = run.collection_name, file.file_name
        file.scope.enter_context(keyed_lock(_replacement_lock_key(collection_name, file_name)))
        file.previous = self._find_previous_versions(collection_name, [file_name]).get(_normalized_file_name(file_name))

        file.preserved = file.previous.preserved if file.previous else {}
        file.row_doc_class = get_document_doc_class(collection_name, file_name)
        file.stored_doc_class = file.row_doc_class or file.preserved.get("doc_class")
        file.base_corpus = legacy_shelf_for_collection_name(collection_name) is None
        file.explicit_doc_class = canonical_doc_class(run.config.get("doc_class"))
        file.doc_class = (
            file.explicit_doc_class
            or file.stored_doc_class
            or (guess_doc_class(file_name) if file.base_corpus else None)
        )

    def _classify_file(self, run: JobRun, file: FileRun) -> None:
        from knowledge_layer.ingest.image_ingest import standalone_image_format

        file.is_pdf = (
            file.rendition is not None
            or file.file_name.lower().endswith(".pdf")
            or Path(file.file_path).suffix.lower() == ".pdf"
            or _looks_like_pdf(file.file_path)
        )
        file.image_format = None if file.is_pdf else standalone_image_format(file.file_path, file.file_name)
        file.is_image = file.image_format is not None

        reads_more = file.is_image or (file.is_pdf and (run.extract_tables or run.extract_images))
        mode_str = "multimodal" if reads_more else "text"
        logger.info(f"Processing file {file.index + 1}/{len(run.file_paths)} (mode={mode_str})")

        with self._lock:
            if file.index < len(run.job.file_details):
                run.job.file_details[file.index].status = FileStatus.INGESTING
                run.job.file_details[file.index].progress_percent = (file.index / len(run.file_paths)) * 100

    def _extract(self, run: JobRun, file: FileRun) -> Extracted | None:
        from knowledge_layer.ingest import file_extraction
        from knowledge_layer.ingest import pdf_ingest
        from knowledge_layer.ingest.renditions import OFFICE_RENDITION_REQUIRED
        from knowledge_layer.ingest.renditions import requires_rendition

        if file.is_pdf:
            return pdf_ingest.read_pdf(self, run, file)
        if file.is_image:
            return file_extraction.read_image(self, run, file)
        if requires_rendition(file.file_name, file.file_path):
            self._update_file_status(run.job, file.index, FileStatus.FAILED, error=OFFICE_RENDITION_REQUIRED)
            logger.warning("No PDF rendition to index %s from", file.file_name)
            return None
        return file_extraction.read_text_file(self, run, file)

    def _indexable(self, run: JobRun, file: FileRun, all_documents: list[Any]) -> list[Any] | None:
        valid_documents = [doc for doc in all_documents if not _looks_like_raw_pdf_or_binary(doc.get_content())]
        if len(valid_documents) != len(all_documents):
            raise ValueError("Raw PDF/binary content detected; refusing to index")
        if not valid_documents:
            self._update_file_status(run.job, file.index, FileStatus.FAILED, error=NO_CONTENT_EXTRACTED)
            logger.warning("No indexable content extracted from %s", file.file_name)
            return None
        return valid_documents

    def _index_documents(self, run: JobRun, file: FileRun, extracted: Extracted) -> None:
        from agent.knowledge.document_classification import DEFAULT_DOC_CLASS
        from knowledge_layer.ingest import document_facts
        from knowledge_layer.ingest import enrichment as ingest_enrichment

        enrichment = ingest_enrichment.start_enrichment(
            self,
            text_documents=extracted.text_documents,
            drawing_pages=extracted.drawing_pages,
            all_documents=extracted.all_documents,
            file_name=file.file_name,
            collection_name=run.collection_name,
            organization_id=run.organization_id,
            base_corpus=file.base_corpus,
            suggest_class=file.stored_doc_class is None
            and file.explicit_doc_class is None
            and file.base_corpus
            and file.doc_class == DEFAULT_DOC_CLASS,
        )
        file.scope.callback(enrichment.close)

        all_documents = self._indexable(run, file, extracted.all_documents)
        if all_documents is None:
            return

        provenance = provenance_from_config(run.config)
        stamp_chunk_metadata(
            all_documents,
            doc_class=file.doc_class,
            provenance=provenance,
            chunk_size=run.chunk_size,
            file_name=file.file_name,
            source_format=filed_mail.source_format_from_config(run.config),
        )

        chunks_created = self._write_chunks(run, file, all_documents)
        if chunks_created is None:
            return

        document_facts.record_facts(self, run, file, extracted, enrichment, all_documents, provenance)

        logger.info(f"Completed file {file.index + 1}/{len(run.file_paths)} ({chunks_created} chunks)")

    def _write_chunks(self, run: JobRun, file: FileRun, all_documents: list[Any]) -> int | None:
        from knowledge_layer.vector_store import write_chunks as qdrant_write_chunks

        from .chunk_identity import chunk_version

        collection_name, file_name = run.collection_name, file.file_name
        self._assert_still_owner(run.job_id)
        version = chunk_version(collection_name, run.config.get("document_id") or file_name, file.source_path)
        with _stage(file.stages, "embedding"):
            records = self._embedded_records(
                all_documents, chunk_size=run.chunk_size, chunk_overlap=run.chunk_overlap, version=version
            )
        self._assert_still_owner(run.job_id)
        file.attempted = [record.chunk_id for record in records]

        with _stage(file.stages, "write"):
            qdrant_write_chunks(collection_name, file_name, records, identity=run.identity, config=run.config)

        if self._deleted_while_indexing(run.config, collection_name):
            self._discard_partial_version(collection_name, file_name, file.attempted)
            file.attempted = None
            file.deleted = True
            self._update_file_status(run.job, file.index, FileStatus.FAILED, error=DOCUMENT_DELETED_DURING_INGEST)
            logger.warning(
                "Discarded the ingest of %s in %s: its document was deleted while it indexed",
                file_name,
                collection_name,
            )
            return None

        chunks_created = len(records)
        run.total_chunks += chunks_created

        self._update_file_status(run.job, file.index, FileStatus.SUCCESS, chunks_created=chunks_created)
        file.attempted = None
        memory_use._log_memory(f"file:written {file_name} elapsed={time.monotonic() - file.started:.0f}s")

        self._retire_previous_version(collection_name, file_name, file.previous, [r.chunk_id for r in records])
        file.retired = True
        return chunks_created
