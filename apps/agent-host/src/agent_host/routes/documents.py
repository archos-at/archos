import asyncio
import logging
import os
import tempfile
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import Request
from fastapi import Response
from fastapi import UploadFile

from agent.knowledge import get_available_documents_async
from agent.knowledge.base import BaseIngestor
from agent.knowledge.schema import AvailableDocument
from agent.knowledge.schema import FileInfo

from ..models.delete_requests import DeleteFilesRequest
from ..models.requests import UploadResponse
from .collections import _require_ingestor
from .collections import require_collection
from .document_edits import rewrite_folder_paths_route
from .document_edits import update_document_display_title_route
from .document_edits import update_document_folder_path_route
from .document_edits import update_document_tags_route
from .document_revisions import put_revision_route
from .documents_jobs import _add_document_job_routes

logger = logging.getLogger(__name__)

READING_UNAVAILABLE_HEADER = "X-Reading-Unavailable"


def _merge_summaries(
    files: list[FileInfo],
    summaries: list[AvailableDocument],
    held_names: Callable[[], set[str] | None] | None = None,
) -> list[FileInfo]:
    if not summaries:
        return files
    doc_by_name = {doc.file_name: doc for doc in summaries}
    for file in files:
        doc = doc_by_name.get(file.file_name)
        if doc is None:
            continue
        if file.summary is None and doc.summary:
            file.summary = doc.summary
        if not file.tags and doc.tags:
            file.tags = doc.tags
        if file.folder_path is None and doc.folder_path:
            file.folder_path = doc.folder_path
        if not file.topics and doc.topics:
            file.topics = doc.topics
        if file.capture is None and doc.capture:
            file.capture = doc.capture
        if file.revision_facts is None and doc.revision_facts:
            file.revision_facts = doc.revision_facts
        if file.dossier is None and doc.dossier:
            file.dossier = doc.dossier
        if file.doc_references is None and doc.doc_references:
            file.doc_references = doc.doc_references
        if file.coverage is None and doc.coverage:
            file.coverage = doc.coverage
        if file.superseded_by is None and doc.superseded_by:
            file.superseded_by = doc.superseded_by
        if not file.supersedes and doc.supersedes:
            file.supersedes = doc.supersedes
        if file.change_summary is None and doc.change_summary:
            file.change_summary = doc.change_summary
            file.change_basis = doc.change_basis
        if file.revision_suggestion is None:
            file.revision_suggestion = _open_suggestion(doc, doc_by_name)
    if held_names is not None:
        _attach_derived_suggestions(files, summaries, held_names)
    return files


def _attach_derived_suggestions(
    files: list[FileInfo], summaries: list[AvailableDocument], held_names: Callable[[], set[str] | None]
) -> None:
    from knowledge_layer.ingest import derive_suggestions

    derived = derive_suggestions(summaries, held_names)
    for file in files:
        suggestion = derived.get(file.file_name)
        if suggestion is not None and file.revision_suggestion is None:
            file.revision_suggestion = suggestion


def _held_names_of(collection_name: str) -> Callable[[], set[str] | None]:

    def held() -> set[str] | None:
        from knowledge_layer.ingest import held_file_names

        return held_file_names(collection_name)

    return held


def _open_suggestion(doc: AvailableDocument, known: dict[str, AvailableDocument]) -> dict[str, Any] | None:
    suggestion = doc.revision_suggestion
    if not suggestion or suggestion.get("dismissed"):
        return None
    older = known.get(suggestion["of"])
    if older is None or older.superseded_by or suggestion["of"] in (doc.supersedes or []):
        return None
    return {key: suggestion[key] for key in ("of", "confidence", "reason", "basis")}


def _unlink_all(paths: list[str]) -> None:
    for path in paths:
        try:
            os.unlink(path)
        except OSError:
            pass


async def _spool_upload(file: UploadFile, temp_paths: list[str], original_filenames: list[str]) -> None:
    original_filename = file.filename or "unknown"
    original_filenames.append(original_filename)
    suffix = f"_{original_filename}" if original_filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        temp_paths.append(tmp.name)
        logger.debug(f"Saved uploaded file to {tmp.name}")


async def upload_documents(
    collection_name: str,
    files: list[UploadFile] = File(..., description="Files to upload"),
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    await require_collection(ingestor, collection_name)

    temp_paths = []
    original_filenames = []
    try:
        for file in files:
            await _spool_upload(file, temp_paths, original_filenames)

        job_id = await asyncio.to_thread(
            ingestor.submit_job,
            temp_paths,
            collection_name,
            config={
                "cleanup_files": True,
                "original_filenames": original_filenames,
            },
        )

        job_status = await asyncio.to_thread(ingestor.get_job_status, job_id)
        file_ids = [fd.file_id for fd in job_status.file_details] if job_status else []

        logger.info(f"Submitted ingestion job {job_id} for {len(files)} file(s)")

        return UploadResponse(
            job_id=job_id,
            file_ids=file_ids,
            message=f"Ingestion job submitted for {len(files)} file(s)",
        )

    except HTTPException:
        _unlink_all(temp_paths)
        raise
    except Exception as e:
        _unlink_all(temp_paths)
        logger.error(f"Failed to upload documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def list_documents(
    collection_name: str,
    response: Response,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> list[FileInfo]:
    await require_collection(ingestor, collection_name)

    try:
        files = await asyncio.to_thread(ingestor.list_files, collection_name)
    except Exception as e:
        logger.error(f"Failed to list documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    try:
        summaries = await get_available_documents_async(collection_name)
        await asyncio.to_thread(_merge_summaries, files, summaries, _held_names_of(collection_name))
    except Exception as e:
        logger.warning(f"Failed to merge summaries for {collection_name}: {e}")
        response.headers[READING_UNAVAILABLE_HEADER] = "1"

    return files


async def get_document_visual_details_route(
    collection_name: str,
    file_name: str,
    http_request: Request,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict:
    from .internal_auth import read_as_internal_office

    try:
        visual = ingestor.get_document_visual_details
        return {"details": await read_as_internal_office(http_request, visual, collection_name, file_name)}
    except Exception as e:
        logger.warning("Failed to fetch visual details for %s/%s: %s", collection_name, file_name, e)
        return {"details": []}


async def delete_files(
    collection_name: str,
    request: DeleteFilesRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, Any]:
    await require_collection(ingestor, collection_name)

    if not request.file_ids and not request.documents:
        return {
            "message": "No file IDs provided",
            "successful": [],
            "failed": [],
            "total_deleted": 0,
        }

    try:
        if request.documents:
            result = await asyncio.to_thread(
                ingestor.delete_documents,
                [(document.id, document.file_name) for document in request.documents],
                collection_name,
                permanent=request.permanent,
            )
        else:
            result = await asyncio.to_thread(
                ingestor.delete_files, request.file_ids, collection_name, permanent=request.permanent
            )
        total_deleted = result.get("total_deleted", 0)
        failed = result.get("failed", [])

        if failed:
            result["message"] = "Some files could not be deleted"
        elif total_deleted == 0:
            result["message"] = "No matching files found"
        else:
            result["message"] = f"Successfully deleted {total_deleted} file(s)"

        return result
    except Exception as e:
        logger.error("Failed to delete files from collection %s: %s", collection_name, type(e).__name__)
        raise HTTPException(status_code=500, detail="Failed to delete files")


def add_document_routes(router: APIRouter):
    router.post(
        "/v1/collections/{collection_name}/documents",
        response_model=UploadResponse,
        status_code=202,
        tags=["documents"],
        summary="Upload documents to a collection",
    )(upload_documents)
    router.get(
        "/v1/collections/{collection_name}/documents",
        response_model=list[FileInfo],
        tags=["documents"],
        summary="List documents in a collection",
    )(list_documents)
    router.get(
        "/v1/collections/{collection_name}/documents/{file_name}/visual-details",
        tags=["documents"],
        summary="Per-page VLM descriptions of a document's visual chunks",
    )(get_document_visual_details_route)
    router.patch(
        "/v1/collections/{collection_name}/documents/{file_name}/tags",
        tags=["documents"],
        summary="Replace a document's controlled tags",
    )(update_document_tags_route)
    router.put(
        "/v1/collections/{collection_name}/revision",
        tags=["documents"],
        summary="Confirm or refuse that one file replaces another (a Fassung across different names)",
    )(put_revision_route)
    router.put("/v1/collections/{collection_name}/fassung", include_in_schema=False)(put_revision_route)
    router.patch(
        "/v1/collections/{collection_name}/documents/{file_name}/display-title",
        tags=["documents"],
        summary="Rename a document (user-facing display title)",
    )(update_document_display_title_route)
    router.patch(
        "/v1/collections/{collection_name}/documents/{file_name}/folder-path",
        tags=["documents"],
        summary="Re-file ONE document into another folder",
    )(update_document_folder_path_route)
    router.patch(
        "/v1/collections/{collection_name}/folder-paths",
        tags=["documents"],
        summary="Re-file every document under a folder path (rename / move / delete mirror)",
    )(rewrite_folder_paths_route)
    router.delete(
        "/v1/collections/{collection_name}/documents",
        tags=["documents"],
        summary="Delete files from a collection",
    )(delete_files)
    _add_document_job_routes(router)
