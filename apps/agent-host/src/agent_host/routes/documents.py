import asyncio
import logging
import os
import tempfile
from collections.abc import Callable
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import Header
from fastapi import HTTPException
from fastapi import Request
from fastapi import Response
from fastapi import UploadFile
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common import provider_limiter
from agent.common.openrouter import limited_async_http_client
from agent.knowledge import dismiss_document_revision_suggestion
from agent.knowledge import get_available_documents_async
from agent.knowledge import link_document_revision
from agent.knowledge import rewrite_document_folder_paths
from agent.knowledge import set_document_change_summary
from agent.knowledge import set_document_display_title
from agent.knowledge import set_document_folder_path
from agent.knowledge import set_document_superseded_by
from agent.knowledge import set_document_tags_by_person
from agent.knowledge import set_document_topics_by_person
from agent.knowledge.base import BaseIngestor
from agent.knowledge.document_classification import ALLOWED_TAGS
from agent.knowledge.document_classification import MAX_TAGS
from agent.knowledge.document_classification import MAX_TOPICS
from agent.knowledge.document_classification import normalize_topic
from agent.knowledge.document_metadata_store import LinkOutcome
from agent.knowledge.document_revisions import RevisionDocument
from agent.knowledge.document_revisions import build_change_prompt
from agent.knowledge.document_revisions import parse_change_summary
from agent.knowledge.document_revisions import settled_change
from agent.knowledge.schema import AvailableDocument
from agent.knowledge.schema import FileInfo
from agent.observability.direct_trace import observed_generation

from ..models.delete_requests import DeleteFilesRequest
from ..models.requests import UploadResponse
from .collections import _require_ingestor
from .collections import require_collection
from .documents_jobs import _add_document_job_routes
from .generate_summary import _llm_settings

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


async def _request_change_summary(
    older: AvailableDocument, newer: AvailableDocument, organization_id: str | None
) -> str | None:
    before = RevisionDocument(
        file_name=older.file_name, summary=older.summary or "", doc_class=older.doc_class, tags=tuple(older.tags or ())
    )
    after = RevisionDocument(
        file_name=newer.file_name, summary=newer.summary or "", doc_class=newer.doc_class, tags=tuple(newer.tags or ())
    )
    settled, answer = settled_change(before, after)
    if settled:
        return answer
    cred = await asyncio.to_thread(_llm_settings, organization_id)
    if not cred.api_key:
        return None
    payload = cred.request_body(
        {
            "model": cred.model,
            "temperature": 0,
            "max_tokens": 400,
            "messages": [{"role": "user", "content": build_change_prompt(before, after)}],
        }
    )
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
    try:
        async with (
            observed_generation("change-summary", model=cred.model, messages=payload.get("messages")) as generation,
            limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=30.0) as client,
        ):
            response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            generation.finish(data)
        return parse_change_summary(data["choices"][0]["message"]["content"] or "")
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Change summary request failed: %s", type(exc).__name__)
        return None


def _checked_tags(raw: list[str]) -> list[str]:
    deduped: list[str] = []
    for tag in raw:
        if tag not in deduped:
            deduped.append(tag)

    offending = [tag for tag in deduped if tag not in ALLOWED_TAGS]
    if offending:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Tags outside the controlled vocabulary are not allowed",
                "invalid_tags": offending,
            },
        )

    if len(deduped) > MAX_TAGS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"At most {MAX_TAGS} tags are allowed per document",
                "max_tags": MAX_TAGS,
                "tag_count": len(deduped),
            },
        )
    return deduped


def _checked_topics(raw: list[str]) -> list[str]:
    invalid = [raw_topic for raw_topic in raw if normalize_topic(raw_topic) is None]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Topics must be a term of up to three words",
                "invalid_topics": invalid,
            },
        )

    controlled = {tag.casefold() for tag in ALLOWED_TAGS}
    kept: dict[str, str] = {}
    for raw_topic in raw:
        term = normalize_topic(raw_topic)
        folded = term.casefold()
        if folded not in controlled:
            kept.setdefault(folded, term)

    topics = list(kept.values())
    if len(topics) > MAX_TOPICS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"At most {MAX_TOPICS} topics are allowed per document",
                "max_topics": MAX_TOPICS,
                "topic_count": len(topics),
            },
        )
    return topics


async def _refuse_revision(collection_name: str, newer: AvailableDocument, older: AvailableDocument) -> dict[str, Any]:
    superseded_by, change_summary, change_basis = older.superseded_by, newer.change_summary, newer.change_basis
    if older.superseded_by == newer.file_name:
        await asyncio.to_thread(set_document_superseded_by, collection_name, older.file_name, None)
        superseded_by = None
        if newer.change_basis == older.file_name:
            await asyncio.to_thread(set_document_change_summary, collection_name, newer.file_name, None, None)
            change_summary = change_basis = None
    await asyncio.to_thread(dismiss_document_revision_suggestion, collection_name, newer.file_name, older.file_name)
    return {"superseded_by": superseded_by, "change_summary": change_summary, "change_basis": change_basis}


def _no_summary_404(collection_name: str, file_name: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
    )


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


class UpdateTagsRequest(BaseModel):
    tags: list[str] = Field(
        default_factory=list,
        description="Controlled document tags; must be a subset of the ingestion vocabulary.",
    )
    topics: list[str] | None = Field(
        default=None,
        description=(
            "Open topics (Themen), free terms of up to three words. Omit to leave the topics as they are; "
            "send tags alone to leave them, too."
        ),
    )


async def update_document_tags_route(
    collection_name: str,
    file_name: str,
    request: UpdateTagsRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, Any]:
    topics = _checked_topics(request.topics) if request.topics is not None else None
    write_tags = "tags" in request.model_fields_set or request.topics is None
    tags = _checked_tags(request.tags) if write_tags else None

    response: dict[str, Any] = {"collection_name": collection_name, "file_name": file_name}
    if topics is not None:
        if not await asyncio.to_thread(set_document_topics_by_person, collection_name, file_name, topics):
            raise _no_summary_404(collection_name, file_name)
        response["topics"] = topics
    if tags is not None:
        if not await asyncio.to_thread(set_document_tags_by_person, collection_name, file_name, tags):
            raise _no_summary_404(collection_name, file_name)
        response["tags"] = tags
    return response


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    newer: str = Field(..., min_length=1, max_length=512, description="File name of the newer Fassung.")
    older: str = Field(..., min_length=1, max_length=512, description="File name of the Fassung it replaces.")
    linked: bool = Field(
        ...,
        description="True: a person confirms newer replaces older. False: a person lifts or refuses that.",
    )


async def _linked_revision_response(
    collection_name: str,
    request: RevisionRequest,
    newer: AvailableDocument,
    older: AvailableDocument,
    organization_id: str | None,
) -> dict[str, Any]:
    change = await _request_change_summary(older, newer, organization_id)
    if change:
        await asyncio.to_thread(set_document_change_summary, collection_name, request.newer, change, request.older)
        return {"superseded_by": request.newer, "change_summary": change, "change_basis": request.older}
    return {
        "superseded_by": request.newer,
        "change_summary": newer.change_summary,
        "change_basis": newer.change_basis,
    }


async def put_revision_route(
    collection_name: str,
    request: RevisionRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
    x_grid_organization_id: str | None = Header(default=None),
) -> dict[str, Any]:
    if request.newer == request.older:
        raise HTTPException(status_code=400, detail="A file cannot replace itself")
    documents = {doc.file_name: doc for doc in await get_available_documents_async(collection_name)}
    missing = [name for name in (request.newer, request.older) if name not in documents]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"No document {missing!r} in collection '{collection_name}'",
        )
    newer, older = documents[request.newer], documents[request.older]

    if not request.linked:
        return await _refuse_revision(collection_name, newer, older)

    outcome = await asyncio.to_thread(link_document_revision, collection_name, request.older, request.newer)
    if outcome is LinkOutcome.LOOP:
        raise HTTPException(
            status_code=409,
            detail=f"'{request.newer}' is already replaced by '{request.older}'; it cannot replace it in turn",
        )
    if outcome is LinkOutcome.MISSING:
        raise _no_summary_404(collection_name, request.older)
    return await _linked_revision_response(collection_name, request, newer, older, x_grid_organization_id)


class UpdateDisplayTitleRequest(BaseModel):
    display_title: str | None = Field(
        default=None,
        description="User-facing document name. Null or blank clears it, restoring the derived default.",
    )


async def update_document_display_title_route(
    collection_name: str,
    file_name: str,
    request: UpdateDisplayTitleRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, str | None]:
    new_title = (request.display_title or "").strip() or None

    updated = await asyncio.to_thread(set_document_display_title, collection_name, file_name, new_title)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
        )

    return {
        "collection_name": collection_name,
        "file_name": file_name,
        "display_title": new_title,
    }


class UpdateFolderPathRequest(BaseModel):
    folder_path: str | None = Field(
        default=None,
        description=(
            "The document's new folder path, e.g. 'Brandschutz/Fluchtwege'. Null or blank files it at the project root."
        ),
    )


async def update_document_folder_path_route(
    collection_name: str,
    file_name: str,
    request: UpdateFolderPathRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, str | None]:
    new_path = (request.folder_path or "").strip() or None

    updated = await asyncio.to_thread(set_document_folder_path, collection_name, file_name, new_path)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
        )

    return {
        "collection_name": collection_name,
        "file_name": file_name,
        "folder_path": new_path,
    }


class RewriteFolderPathRequest(BaseModel):
    from_path: str = Field(
        ...,
        min_length=1,
        description="The folder path as it was before the rename/move/delete, e.g. 'Brandschutz/Fluchtwege'.",
    )
    to_path: str | None = Field(
        default=None,
        description="The folder path it became. Null or blank re-files the subtree at the project root.",
    )


async def rewrite_folder_paths_route(
    collection_name: str,
    request: RewriteFolderPathRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(
        rewrite_document_folder_paths, collection_name, request.from_path, request.to_path
    )
    return {
        "collection_name": collection_name,
        "from_path": request.from_path,
        "to_path": (request.to_path or "").strip() or None,
        "updated": updated,
    }


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
