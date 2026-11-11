"""OIB admin routes."""

import asyncio
import logging
import os
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import Form
from fastapi import Header
from fastapi import HTTPException
from fastapi import Query
from fastapi import UploadFile
from fastapi import status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydantic import Field

from agent.corpus_store import CorpusFileImmutable
from agent.knowledge.document_classification import canonical_doc_class
from agent.oib_status import OibKnowledgeStatus

from ..corpus_upload import MAX_OIB_UPLOAD_BYTES
from ..corpus_upload import SQUATTED_NAME_REASON
from ..corpus_upload import extract_zip_pdfs
from ..corpus_upload import is_zip_upload
from ..corpus_upload import sanitize_pdf_name
from ..corpus_upload import squats_a_text_name
from ..jobs.ingest_dispatch import enqueue_only
from ..models.knowledge_mark import OibReingestRequest
from ..models.requests import OibDocumentDeleteResponse
from ..models.requests import OibDocumentUploadResponse
from ..models.requests import OibReingestResponse
from ..models.requests import OibSyncResponse
from ..models.requests import OibUploadedMember
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

_ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN")


def _require_admin_token(x_admin_token: str | None = Header(default=None)):
    if not _ADMIN_TOKEN:
        return
    if x_admin_token != _ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token")


def _require_admin_token_strict(x_admin_token: str | None = Header(default=None)):
    """The admin token, failing CLOSED when none is configured.

    ``_require_admin_token`` lets every request through on a deployment without
    ``ADMIN_TOKEN`` (local dev). An export hands the whole licensed corpus
    to whoever asks, so it never runs unguarded.
    """
    if not _ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Corpus export disabled")
    _require_admin_token(x_admin_token)


def _corpus_tarball() -> Path:
    """Every PDF in the corpus, flat under its basename, as a .tar.gz in a temp file.

    The corpus table is the set the agent indexes, so a consumer that ingests
    this tarball indexes what production indexes. Each file is fetched into this
    replica's cache on the way if it is not there yet. PDFs are already
    compressed; level 1 spends no time on a gain that is not there.
    """
    from agent import corpus_store

    handle = tempfile.NamedTemporaryFile(prefix="oib-corpus-", suffix=".tar.gz", delete=False)
    handle.close()
    path = Path(handle.name)
    try:
        with tarfile.open(path, "w:gz", compresslevel=1) as archive:
            for name in sorted(corpus_store.list_files()):
                pdf = corpus_store.ensure_local(name)
                if pdf is not None:  # deleted since the listing
                    archive.add(pdf, arcname=name)
    except BaseException:
        # The response's cleanup is only attached once this returns; a failed
        # build would otherwise leave a partial copy of the corpus on disk.
        path.unlink(missing_ok=True)
        raise
    return path


class _TemporaryFileResponse(FileResponse):
    """A ``FileResponse`` that deletes its file however the response ends.

    A background task is not enough: Starlette answers a malformed or
    unsatisfiable ``Range`` (400, 416) and a client that disconnects mid-send
    without ever reaching it, and each would leave a copy of the corpus behind.
    """

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            Path(self.path).unlink(missing_ok=True)


# The two below import late: the corpus and the status pull the knowledge layer in.
def _run_ingestion():
    from agent.oib_sync import sync

    from ..jobs.corpus_payloads import mark_corpus_chunks

    return sync(enqueue=enqueue_only, mark_chunks=mark_corpus_chunks)


def _compute_status():
    from agent.oib_status import get_status

    return get_status()


def _store_upload(name: str, content: bytes, doc_class: str | None) -> None:
    """Store an uploaded PDF in the shared corpus and queue its ingestion (``oib_sync.store_and_request``).

    Write-then-ingest ordering: the file is durably stored BEFORE the route
    responds, so an upload is never lost even if ingestion is slow to start or the
    process restarts — the next sync cycle queues it if this call could not. A
    name the corpus keeps takes the same bytes as a no-op and any others not at
    all (``CorpusFileImmutable``, ADR-0165): to change a document, remove it
    first. The ingestion is a job on the ingest queue, run by whoever claims
    it; nothing is ingested here. A store that refuses the object raises, and
    the route answers with an error rather than a pending job that would never
    find its file; so does a queue that cannot take the job.
    """
    from agent import oib_sync

    oib_sync.store_and_request(name, content, doc_class, enqueue=enqueue_only)


def _queue_reingest(names: list[str], marks: dict | None = None) -> tuple[list[str], list[str]]:
    """``(queued, unknown)``: each known name made to need ingestion again (with its mark), and a job queued for it."""
    from agent import oib_sync

    queued: list[str] = []
    unknown: list[str] = []
    for name in names:
        if not oib_sync.mark_for_reingest(name, (marks or {}).get(name)):
            unknown.append(name)
            continue
        oib_sync.request_ingestion(name, enqueue=enqueue_only)
        queued.append(name)
    return queued, unknown


def _remove_document(name: str) -> bool:
    from agent import oib_sync

    return oib_sync.remove_document(name)


def _resolve_corpus_pdf(file_name: str) -> Path | None:
    """The local path of a corpus PDF by name, fetched into this replica's cache if needed.

    Refuses any path component in the input; ``None`` when the corpus does not
    list the file. A listed file that cannot be fetched raises ``CorpusStoreError``.
    """
    from agent import corpus_store

    return corpus_store.ensure_local(file_name)


# 2 workers for the admin's blocking calls (a sync cycle, a delete). Ingestion is not
# here: it is a job on the ingest queue, claimed by the ingest workers. Overlapping calls
# are safe because oib_sync serializes what must not interleave: a per-file lock, across
# replicas, around queueing a job and deleting a file, and one sync cycle at a time.
_ADMIN_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="oib-sync-")


async def sync_oib_documents(
    _: None = Depends(_require_admin_token),
) -> OibSyncResponse:
    try:
        result = await asyncio.get_event_loop().run_in_executor(_ADMIN_EXECUTOR, _run_ingestion)
        return OibSyncResponse(
            status="ok",
            message=(
                f"OIB sync finished: {result.enqueued} file(s) queued for ingestion, "
                f"{result.ingested_recorded} finished, {result.failed} failed, {result.total} total tracked"
            ),
            files_added=result.enqueued,
            files_total=result.total,
        )
    except Exception as e:
        logger.exception("OIB sync failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


async def export_oib_corpus(
    _: None = Depends(_require_admin_token_strict),
) -> FileResponse:
    """The corpus as a tarball, built on a worker thread into a temp file
    that is removed once the response ends.

    Its only consumer was the answer-suite CI workflow, which has been
    removed; the export stays until someone decides to delete it.
    """
    path = await asyncio.to_thread(_corpus_tarball)
    return _TemporaryFileResponse(path, media_type="application/gzip", filename="oib-corpus.tar.gz")


async def get_oib_status() -> OibKnowledgeStatus:
    """Merged per-file view of the OIB corpus (corpus table vs. index).

    Read-only and unprivileged on purpose: it powers the user-facing
    knowledge-base transparency panel. Runs on a worker thread because it
    queries the database and the vector store.
    """
    try:
        return await asyncio.to_thread(_compute_status)
    except Exception as e:
        logger.exception("OIB status failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e


_NOT_AVAILABLE = "Source PDF not available"


async def _serve_corpus_pdf(file_name: str) -> FileResponse:
    """The PDF inline; 404 when the corpus does not list it, 503 when it lists it and the store cannot serve it."""
    from agent.corpus_store import CorpusStoreError

    try:
        path = await asyncio.to_thread(_resolve_corpus_pdf, file_name)
    except CorpusStoreError as e:
        logger.exception("Could not fetch %s for the PDF viewer", file_name)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=path.name,
        content_disposition_type="inline",
    )


def _released_to(file_name: str, countries: list[str]) -> bool:
    from agent import corpus_store

    return corpus_store.released_to(file_name, countries)


async def get_corpus_document(
    file_name: str,
    country: list[str] = Query(default_factory=list),
    _: None = Depends(_require_internal_token),
) -> FileResponse:
    """The original PDF of a file released in one of the caller's countries, for the viewer of a cited source.

    ``country`` is the office's entitled countries, which the BFF decided (this tier decides no access);
    the file's mark is what a release wrote (``corpus_store.released_to``, the rule the chunk reads pass).
    A file the countries do not read answers exactly as a name the corpus does not list, so the answer
    cannot tell whether it exists: an unmarked draft, a rolled-back text, another country's file, and a
    read that names no country. Internal-token only: the caller states whose countries these are.
    """
    if not await asyncio.to_thread(_released_to, file_name, country):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return await _serve_corpus_pdf(file_name)


async def get_corpus_document_as_platform(
    file_name: str,
    _: None = Depends(_require_admin_token),
) -> FileResponse:
    """The original PDF of any file the corpus lists, released or not: the platform operator's read."""
    return await _serve_corpus_pdf(file_name)


def _resolved_doc_class(doc_class: str | None, name: str) -> str:
    """The Dokumentart a single upload is stored under: the explicit one (400 when off-vocabulary), else guessed."""
    from agent.common.norm_registry import guess_doc_class

    if doc_class is not None:
        # An admin tab that has not reloaded since the rename still sends the German key.
        canonical = canonical_doc_class(doc_class)
        if canonical is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown doc_class '{doc_class}'",
            )
        doc_class = canonical
    return doc_class if doc_class is not None else guess_doc_class(name)


async def upload_oib_document(
    file: UploadFile = File(..., description="PDF, or a ZIP of PDFs, to add to the base knowledge corpus"),
    doc_class: str | None = Form(
        None,
        description="Optional explicit doc_class ('Dokumentart'). Omitted → guessed from the filename.",
    ),
    _: None = Depends(_require_admin_token),
) -> OibDocumentUploadResponse:
    """Platform-admin upload. Stores the file(s) in the shared corpus (object
    store plus table row) and queues each file's ingestion on the durable ingest
    queue, where the ingest workers claim it — the route returns promptly (status
    ``pending``) and the UI tracks progress via ``/v1/oib/status``.
    Write-then-ingest ordering guarantees a file is durably stored before the
    response, so an upload is never lost.

    - A single PDF: ``doc_class`` is validated (400 if off-vocabulary) or
      guessed from the filename, and stamped onto the summary row once
      ingestion succeeds.
    - A ZIP (its bytes start as one, and it is named ``*.zip``): member PDFs
      are extracted safely (zip-slip, NUL and backslash names rejected, non-PDFs
      skipped, per-member + total size capped), each queued for ingestion with a filename-guessed doc_class
      (bulk onboarding; per-file class is corrected later via PATCH).
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    if len(content) > MAX_OIB_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {MAX_OIB_UPLOAD_BYTES // (1024 * 1024)} MB limit",
        )

    if is_zip_upload(file, content):
        return await _handle_zip_upload(content)

    # Single-PDF upload.
    name = sanitize_pdf_name(file.filename)
    if squats_a_text_name(name, content):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Not stored: {SQUATTED_NAME_REASON}")
    resolved_class = _resolved_doc_class(doc_class, name)

    try:
        await asyncio.to_thread(_store_upload, name, content, resolved_class)
    except CorpusFileImmutable as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except Exception as e:
        logger.exception("Failed to store or queue OIB upload %s", name)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e

    return OibDocumentUploadResponse(
        status="pending",
        kind="file",
        file_name=name,
        doc_class=resolved_class,
        message=f"{name} accepted; ingestion queued (poll /v1/oib/status)",
    )


async def _handle_zip_upload(content: bytes) -> OibDocumentUploadResponse:
    from agent.common.norm_registry import guess_doc_class

    accepted, rejected = await asyncio.to_thread(extract_zip_pdfs, content)
    if not accepted and not rejected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ZIP archive contained no PDF files",
        )

    members: list[OibUploadedMember] = []
    for base_name, data in accepted:
        member_class = guess_doc_class(base_name)
        try:
            await asyncio.to_thread(_store_upload, base_name, data, member_class)
        except CorpusFileImmutable:
            members.append(
                OibUploadedMember(
                    file_name=base_name, status="rejected", reason="the corpus keeps other bytes under this name"
                )
            )
            continue
        except Exception:
            logger.exception("Failed to store or queue ZIP member %s", base_name)
            members.append(
                OibUploadedMember(file_name=base_name, status="rejected", reason="could not store or queue it")
            )
            continue
        members.append(OibUploadedMember(file_name=base_name, status="pending", doc_class=member_class))

    for name, reason in rejected:
        members.append(OibUploadedMember(file_name=name, status="rejected", reason=reason))

    accepted_count = sum(1 for m in members if m.status == "pending")
    rejected_count = sum(1 for m in members if m.status == "rejected")
    return OibDocumentUploadResponse(
        status="pending",
        kind="zip",
        accepted=accepted_count,
        rejected=rejected_count,
        members=members,
        message=f"{accepted_count} PDF(s) accepted; ingestion queued. {rejected_count} rejected/skipped.",
    )


async def delete_oib_document(
    file_name: str,
    _: None = Depends(_require_admin_token),
) -> OibDocumentDeleteResponse:
    """Deletes a base-corpus document: its indexed chunks, summary registration,
    corpus row, stored object and this replica's cached copy. A name only the
    index still knows (chunks a half-finished delete left behind) is cleared
    the same way.
    """
    try:
        removed = await asyncio.get_event_loop().run_in_executor(_ADMIN_EXECUTOR, _remove_document, file_name)
    except Exception as e:
        logger.exception("OIB document delete failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e

    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No base-corpus document with that name",
        )
    return OibDocumentDeleteResponse(success=True, file_name=file_name)


async def reingest_oib_documents(
    request: OibReingestRequest,
    _: None = Depends(_require_admin_token),
) -> OibReingestResponse:
    """Force a rebuild of specific documents' chunks.

    `sync()` is incremental and gates on the sha256 of the PDF bytes, so it is a no-op
    for a document whose file has not changed. That is the right default and the wrong
    behaviour after anything that changes how chunks are BUILT rather than what they
    are built from — a chunking change, an embedding-model change, a partially failed
    ingest. Until now the only remedy was a corpus-wide re-ingest of all 39 PDFs
    including VLM captioning.

    Queued, not awaited, exactly like an upload: each document is a job on the ingest
    queue, which takes up to ten minutes once a worker claims it. The caller polls
    `/v1/oib/status`, where a queued document reads PENDING until its chunks are rebuilt.

    Unknown names are REPORTED rather than failing the request — a selection of twenty
    documents should not be lost because one was deleted in another tab.
    """

    names = list(dict.fromkeys(request.file_names))
    try:
        queued, unknown = await asyncio.get_event_loop().run_in_executor(
            _ADMIN_EXECUTOR, _queue_reingest, names, request.file_marks()
        )
    except Exception as e:
        logger.exception("OIB re-ingest could not be queued")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e

    if not queued:
        return OibReingestResponse(
            status="noop",
            queued=[],
            unknown=unknown,
            message="No base-corpus document matched the requested names",
        )
    message = f"Re-ingest queued for {len(queued)} document(s)"
    if unknown:
        message += f"; {len(unknown)} unknown name(s) skipped"
    return OibReingestResponse(status="pending", queued=queued, unknown=unknown, message=message)


class UpdateDocClassRequest(BaseModel):
    doc_class: str = Field(..., description="Explicit doc_class ('Dokumentart'); must be in the vocabulary.")


async def update_oib_doc_class(
    file_name: str,
    request: UpdateDocClassRequest,
    _: None = Depends(_require_admin_token),
) -> dict[str, str]:
    """Set the explicit ``doc_class`` on a base-corpus document's summary row.

    Because retrieval is store-authoritative for ``doc_class`` (the resolver
    in ``knowledge_layer`` prefers the stored value over chunk metadata), this
    edit reflects immediately with NO re-ingest. Validates against the closed
    vocabulary (400 off-vocabulary) and 404s when no summary row exists for
    the document (the summary is the anchor; there is nothing to classify
    without one).
    """
    from agent import oib_sync
    from agent.knowledge.factory import set_document_doc_class
    from agent.knowledge.factory import set_document_doc_class_suggestion

    name = Path(file_name).name
    doc_class = canonical_doc_class(request.doc_class)
    if doc_class is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown doc_class '{request.doc_class}'",
        )

    try:
        updated = await asyncio.to_thread(set_document_doc_class, oib_sync.COLLECTION_NAME, name, doc_class)
    except Exception as e:
        logger.exception("OIB doc_class update failed for %s", name)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No summary found for '{name}' in the base corpus",
        )
    # A person has decided; the suggestion has nothing left to offer.
    try:
        await asyncio.to_thread(set_document_doc_class_suggestion, oib_sync.COLLECTION_NAME, name, None)
    except Exception:  # noqa: BLE001 — the class is set; a stale offer is cosmetic
        logger.warning("Could not clear the Dokumentart suggestion for %s", name)
    return {"file_name": name, "doc_class": doc_class}


class UpdateDisplayTitleRequest(BaseModel):
    display_title: str | None = Field(
        default=None,
        description="User-facing document name. Empty/null clears the override so the derived default applies.",
    )


async def update_oib_display_title(
    file_name: str,
    request: UpdateDisplayTitleRequest,
    _: None = Depends(_require_admin_token),
) -> dict[str, str | None]:
    """Set the user-facing ``display_title`` on a base-corpus document's row.

    Retrieval is store-authoritative for the display title (the knowledge
    layer prefers the stored value over the derived filename default), so a
    rename reflects on citation chips immediately with NO re-ingest. A null or
    blank value clears the override, restoring the derived default. 404s when
    no metadata row exists for the document (the summary is the anchor).
    """
    from agent import oib_sync
    from agent.knowledge.factory import set_document_display_title

    name = Path(file_name).name
    new_title = (request.display_title or "").strip() or None

    try:
        updated = await asyncio.to_thread(set_document_display_title, oib_sync.COLLECTION_NAME, name, new_title)
    except Exception as e:
        logger.exception("OIB display_title update failed for %s", name)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) from e

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No summary found for '{name}' in the base corpus",
        )
    return {"file_name": name, "display_title": new_title}


def add_oib_routes(router: APIRouter) -> None:
    router.post(
        "/v1/admin/oib/sync",
        response_model=OibSyncResponse,
        tags=["oib"],
        summary="Trigger incremental OIB PDF ingestion",
    )(sync_oib_documents)
    router.get(
        "/v1/admin/oib/corpus.tar.gz",
        tags=["oib"],
        summary="Export the OIB base corpus as a .tar.gz of its PDFs",
    )(export_oib_corpus)
    router.get(
        "/v1/oib/status",
        response_model=OibKnowledgeStatus,
        tags=["oib"],
        summary="Report exactly which OIB documents the knowledge base has indexed",
    )(get_oib_status)
    router.get(
        "/v1/corpus/documents/{file_name}",
        tags=["corpus"],
        summary="Stream a source PDF of the base corpus to a reader of the countries it is released in",
    )(get_corpus_document)
    router.get(
        "/v1/admin/corpus/documents/{file_name}",
        tags=["corpus"],
        summary="Stream any source PDF of the base corpus, released or not",
    )(get_corpus_document_as_platform)
    router.post(
        "/v1/admin/oib/documents",
        response_model=OibDocumentUploadResponse,
        tags=["oib"],
        summary="Upload a PDF (or a ZIP of PDFs) into the shared OIB base corpus",
    )(upload_oib_document)
    router.delete(
        "/v1/admin/oib/documents/{file_name}",
        response_model=OibDocumentDeleteResponse,
        tags=["oib"],
        summary="Delete a document from the OIB base corpus",
    )(delete_oib_document)
    router.post(
        "/v1/admin/oib/reingest",
        response_model=OibReingestResponse,
        tags=["oib"],
        summary="Re-index selected base-corpus documents without touching the rest",
    )(reingest_oib_documents)
    router.patch(
        "/v1/admin/oib/documents/{file_name}/doc-class",
        tags=["oib"],
        summary="Reclassify an OIB base-corpus document's Dokumentart",
    )(update_oib_doc_class)
    router.patch(
        "/v1/admin/oib/documents/{file_name}/display-title",
        tags=["oib"],
        summary="Rename an OIB base-corpus document (user-facing display title)",
    )(update_oib_display_title)
