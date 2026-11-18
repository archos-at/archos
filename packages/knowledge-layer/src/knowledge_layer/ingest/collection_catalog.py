import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from agent.knowledge import ingest_status_store
from agent.knowledge.schema import CollectionInfo
from agent.knowledge.schema import FileInfo
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent.knowledge.schema import stable_file_id
from knowledge_layer.ingest.listing import LISTING_FIELDS
from knowledge_layer.ingest.listing import files_from_payloads
from knowledge_layer.ingest.listing import from_epoch

from . import limits
from .stored_names import _stored_name_matches

logger = logging.getLogger(__name__)

_LISTING_PAGE = 2048


def bump_collection_version(collection_name: str) -> None:
    from agent.knowledge import collection_version as _collection_version

    _collection_version.bump(collection_name)


def _file_info_from_job(job: IngestionJobStatus, detail: FileProgress) -> FileInfo:
    status, error = detail.status, detail.error_message
    if status not in (FileStatus.SUCCESS, FileStatus.FAILED) and job.status == JobState.FAILED:
        status, error = FileStatus.FAILED, error or job.error_message
    return FileInfo(
        file_id=stable_file_id(job.collection_name, detail.file_name),
        file_name=detail.file_name,
        collection_name=job.collection_name,
        status=status,
        chunk_count=detail.chunks_created,
        uploaded_at=job.submitted_at,
        ingested_at=job.completed_at if status == FileStatus.SUCCESS else None,
        error_message=error,
        quarantine=detail.quarantine,
        metadata={"job_id": job.job_id},
    )


def _merge_file_records(indexed: FileInfo | None, recorded: FileInfo | None) -> FileInfo | None:
    if recorded is None:
        return indexed
    if indexed is None:
        return None if recorded.status == FileStatus.SUCCESS else recorded
    return recorded.model_copy(
        update={
            "chunk_count": indexed.chunk_count,
            "file_size": recorded.file_size or indexed.file_size,
            "uploaded_at": recorded.uploaded_at or indexed.uploaded_at,
            "ingested_at": recorded.ingested_at or indexed.ingested_at,
            "metadata": {**indexed.metadata, **recorded.metadata},
        }
    )


def _int_or(value: Any, default: int) -> int:
    try:
        return int(value)
    except TypeError, ValueError:
        return default


def _drawing_data(raw: Any) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except TypeError, ValueError:
        return None


def _visual_detail(meta: dict[str, Any], text: str) -> dict[str, Any]:
    body = text.split("\n\n", 1)[1] if "\n\n" in text else text
    return {
        "page": _int_or(meta.get("page_label") or 0, 0),
        "content_type": meta.get("content_type"),
        "drawing_type": meta.get("drawing_type") or "",
        "scale": meta.get("drawing_scale") or "",
        "text": body.strip(),
        "segment": _int_or(meta.get("segment_index") or 0, 0),
        "segment_count": max(1, _int_or(meta.get("segment_count") or 1, 1)),
        "structured": _drawing_data(meta.get("drawing_data")),
    }


class CollectionCatalog:
    @staticmethod
    def _store():
        from knowledge_layer.vector_store import get_store

        return get_store()

    def _chunk_ids_of(self, collection_name: str, stored_names: list[str]) -> list[tuple[str, str]]:
        if not stored_names:
            return []
        from knowledge_layer.vector_store import CHUNK_ID_FIELD

        records = self._store().scroll(
            collection_name,
            {"file_name": {"$in": sorted(set(stored_names))}},
            fields=[CHUNK_ID_FIELD, "file_name"],
            page_size=_LISTING_PAGE,
        )
        return [
            (str((record.payload or {}).get(CHUNK_ID_FIELD) or record.id), str((record.payload or {}).get("file_name")))
            for record in records
        ]

    def _collection_info(self, name: str, chunk_count: int | None = None) -> CollectionInfo:
        from knowledge_layer.vector_store import INDEXED_AT_FIELD

        store = self._store()
        count = store.count(name) if chunk_count is None else chunk_count
        files = len(store.file_counts(name)) if count else 0
        return CollectionInfo(
            name=name,
            file_count=files,
            chunk_count=count,
            created_at=from_epoch(store.newest(name, INDEXED_AT_FIELD, oldest=True) if count else None),
            updated_at=from_epoch(store.newest(name, INDEXED_AT_FIELD) if count else None),
            backend=self.backend_name,
            metadata={"embed_model": self.embed_model_name},
        )

    def create_collection(
        self,
        name: str,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CollectionInfo:
        info = self._collection_info(name)
        return info.model_copy(update={"description": description}) if description else info

    def delete_collection(self, name: str) -> bool:
        try:
            self._store().delete_scope(name)
            with self._lock:
                self._jobs = {jid: job for jid, job in self._jobs.items() if job.collection_name != name}
            ingest_status_store.forget_collection(name)

            from agent.knowledge import clear_collection_summaries

            clear_collection_summaries(name)
            bump_collection_version(name)

            logger.info(f"Deleted collection: {name}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete collection {name}: {e}")
            return False

    def list_collections(self) -> list[CollectionInfo]:
        from knowledge_layer.vector_store import Physical

        store = self._store()
        counts: dict[str, int] = {}
        for physical in Physical:
            counts.update(store.scope_counts(physical))
        result = [self._collection_info(name, count) for name, count in sorted(counts.items())]
        logger.info(f"Listed {len(result)} collections")
        return result

    def get_collection(self, name: str) -> CollectionInfo:
        return self._collection_info(name)

    def upload_file(
        self,
        file_path: str,
        collection_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> FileInfo:
        file_path_obj = Path(file_path)
        file_name = file_path_obj.name
        file_id = stable_file_id(collection_name, file_name)

        if not file_path_obj.exists():
            return FileInfo(
                file_id=file_id,
                file_name=file_name,
                collection_name=collection_name,
                status=FileStatus.FAILED,
                error_message=f"File not found: {file_path}",
            )

        job_id = self.submit_job(
            file_paths=[file_path],
            collection_name=collection_name,
            config=dict(metadata or {}),
        )
        logger.info(f"Uploaded file to {collection_name} (file_id={file_id}, job_id={job_id})")

        return FileInfo(
            file_id=file_id,
            file_name=file_name,
            collection_name=collection_name,
            status=FileStatus.INGESTING,
            file_size=file_path_obj.stat().st_size,
            uploaded_at=datetime.utcnow(),
            metadata={**(metadata or {}), "job_id": job_id},
        )

    def _file_name_of(self, file_id: str, collection_name: str) -> str:
        try:
            uuid.UUID(file_id)
        except ValueError:
            return file_id
        listed = next((f for f in self.list_files(collection_name) if f.file_id == file_id), None)
        return listed.file_name if listed is not None else file_id

    def delete_file(self, file_id: str, collection_name: str, *, permanent: bool = False) -> bool:
        file_name = self._file_name_of(file_id, collection_name)
        forgotten = ingest_status_store.forget_file(collection_name, file_name)
        chunks = self._chunk_ids_of(collection_name, self._spellings_in(collection_name, file_name))
        return self._purge(collection_name, [file_name], chunks, forgotten, permanent=permanent)

    def delete_document(
        self, document_id: str, file_name: str, collection_name: str, *, permanent: bool = False
    ) -> bool:
        from knowledge_layer.vector_store import CHUNK_ID_FIELD
        from knowledge_layer.vector_store import DOCUMENT_ID_FIELD

        forgotten = ingest_status_store.forget_file(collection_name, file_name)
        by_id: dict[str, Any] = {DOCUMENT_ID_FIELD: {"$eq": document_id}}
        spellings = self._spellings_in(collection_name, file_name)
        unclaimed = {"$and": [{"file_name": {"$in": spellings}}, {DOCUMENT_ID_FIELD: {"$exists": False}}]}
        records = self._store().scroll(
            collection_name,
            {"$or": [by_id, unclaimed]} if spellings else by_id,
            fields=[CHUNK_ID_FIELD, "file_name"],
            page_size=_LISTING_PAGE,
        )
        chunks = [
            (str((record.payload or {}).get(CHUNK_ID_FIELD) or record.id), str((record.payload or {}).get("file_name")))
            for record in records
        ]
        names = [file_name, *sorted({stored for _, stored in chunks} - {file_name})]
        return self._purge(collection_name, names, chunks, forgotten, permanent=permanent)

    def _spellings_in(self, collection_name: str, file_name: str) -> list[str]:
        return sorted(
            stored
            for stored in self._store().file_counts(collection_name)
            if stored == file_name or _stored_name_matches(file_name, stored)
        )

    def _purge(
        self,
        collection_name: str,
        names: list[str],
        chunks: list[tuple[str, str]],
        forgotten: int,
        *,
        permanent: bool,
    ) -> bool:
        from agent.knowledge import unregister_summary

        file_name = names[0]
        if not chunks:
            if forgotten:
                logger.info(f"Removed {forgotten} job record(s) of file {file_name}")
            else:
                logger.warning(f"No chunks found for file_name={file_name}; clearing its summary")
            unregister_summary(collection_name, file_name, permanent=permanent)
            return forgotten > 0

        self._store().delete_chunks(collection_name, [chunk_id for chunk_id, _ in chunks])
        bump_collection_version(collection_name)
        logger.info(f"Deleted {len(chunks)} chunks for file {file_name}")
        for name in names:
            unregister_summary(collection_name, name, permanent=permanent)
        return True

    def _indexed_files(self, collection_name: str) -> dict[str, FileInfo]:
        records = self._store().scroll(collection_name, None, fields=LISTING_FIELDS, page_size=_LISTING_PAGE)
        return files_from_payloads(collection_name, (record.payload for record in records))

    @staticmethod
    def _recorded_files(collection_name: str) -> dict[str, FileInfo]:
        records: dict[str, FileInfo] = {}
        for job in ingest_status_store.collection_jobs(collection_name, limits.FILE_TRACKING_RETENTION_SECONDS):
            for detail in job.file_details:
                records[detail.file_name] = _file_info_from_job(job, detail)
        return records

    def list_files(self, collection_name: str) -> list[FileInfo]:
        try:
            indexed = self._indexed_files(collection_name)
            recorded = self._recorded_files(collection_name)

            merged = (_merge_file_records(indexed.get(name), recorded.get(name)) for name in {**indexed, **recorded})
            result = [record for record in merged if record is not None]

            logger.info(f"Listed {len(result)} files in {collection_name}")
            return result

        except Exception as e:
            logger.error(f"Failed to list files in {collection_name}: {e}")
            return []

    def get_file_status(self, file_id: str, collection_name: str) -> FileInfo | None:
        return next((f for f in self.list_files(collection_name) if f.file_id == file_id), None)

    def get_document_text_sample(self, collection_name: str, file_name: str, max_chars: int = 4000) -> str | None:
        from agent.knowledge.base import READING_ORDER
        from knowledge_layer.vector_store import fetch as qdrant_fetch
        from knowledge_layer.vector_store import reading_for_maintenance

        try:
            with reading_for_maintenance():
                hits = qdrant_fetch(collection_name, {"file_name": file_name}, 5, READING_ORDER)
        except Exception as e:
            logger.warning("Reconciliation: failed to fetch chunks for %s in %s: %s", file_name, collection_name, e)
            return None

        combined = "\n".join(hit.text for hit in hits[:5] if hit.text)
        return combined[:max_chars] if combined else None

    def get_document_visual_details(self, collection_name: str, file_name: str) -> list[dict[str, Any]]:
        from knowledge_layer import vector_store

        visual = {"file_name": file_name, "content_type": {"$in": ["drawing", "image", "chart"]}}
        try:
            records = list(self._store().scroll(collection_name, visual, *vector_store.office_read(collection_name)))
        except Exception as e:
            logger.warning("Visual details lookup failed for %s in %s: %s", file_name, collection_name, e)
            return []

        items: list[dict[str, Any]] = []
        for record in records:
            meta = record.payload or {}
            text = meta.get(vector_store.TEXT_FIELD) or ""
            if text:
                items.append(_visual_detail(meta, text))

        items.sort(key=lambda it: (it["page"], it["content_type"], it["segment"]))
        return items
