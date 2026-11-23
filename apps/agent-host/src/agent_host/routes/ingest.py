import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import unquote
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter
from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException

from agent.common.connect_retry import CONNECT_RETRIES
from agent.common.connect_retry import CONNECT_TIMEOUT_SECONDS
from agent.common.source_kinds import MAIL_SOURCE_FORMAT
from agent.knowledge.base import BaseIngestor

from ..models.requests import IngestRequest
from ..object_store_url import assert_fetchable_object_store_url
from ..object_store_url import object_store_request_url
from .collections import _require_ingestor

logger = logging.getLogger(__name__)


def add_ingest_routes(router: APIRouter):

    @router.post(
        "/v1/ingest",
        status_code=202,
        tags=["ingestion"],
        summary="Ingest a file from a URL reference",
        description=(
            "Submits an ingestion job that downloads the file when it runs. Every URL in the body"
            " must name the object store (`ObjectStoreUrl`); nothing is downloaded in the request."
        ),
        responses={
            400: {"description": "Invalid request: no collection"},
            500: {"description": "The job could not be submitted"},
        },
    )
    async def ingest_from_url(
        request: IngestRequest,
        ingestor: BaseIngestor = Depends(_require_ingestor),
        x_grid_organization_id: str | None = Header(default=None),
    ) -> dict:
        if not request.collection:
            raise HTTPException(status_code=400, detail="collection is required")

        dispatch_key = _dispatch_key(request)
        async with _dispatch_slot(dispatch_key):
            existing = await _live_job(ingestor, dispatch_key)
            if existing:
                logger.info("Dispatch joined the live ingestion job %s", existing)
                return {"job_id": existing, "status": "pending", "document_id": request.document_id}
            job_id = await _submit(ingestor, request, _job_config(request, x_grid_organization_id, dispatch_key))
        return {"job_id": job_id, "status": "pending", "document_id": request.document_id}


async def _submit(ingestor: BaseIngestor, request: IngestRequest, config: dict) -> str:
    original = DeferredObjectDownload(request.file_ref)
    try:
        job_id = await asyncio.to_thread(_submit_durably, ingestor, [original], request.collection, config)
    except Exception as error:
        logger.exception("Ingestion submit failed: %s", type(error).__name__)
        raise HTTPException(status_code=500, detail="Ingestion failed") from None
    logger.info("Submitted ingestion job %s for %s", job_id, config["original_filenames"][0])
    return job_id


def _submit_durably(ingestor: BaseIngestor, files: list, collection: str, config: dict) -> str:
    if getattr(ingestor, "supports_durable_jobs", False) is not True:
        return ingestor.submit_job(files, collection, config=config)
    from ..jobs import ingest_dispatch

    prepared = ingestor.prepare_job(files, collection, config)
    ingest_dispatch.dispatch(ingestor, prepared)
    return prepared.job_id


def _job_config(request: IngestRequest, organization_id: str | None, dispatch_key: str | None) -> dict:
    config: dict = {
        "cleanup_files": True,
        "original_filenames": [request.file_name or _extract_filename(request.file_ref)],
        "priority": request.priority,
        "original_bytes": request.byte_size,
    }
    if thumbnail_url := request.thumbnail_upload_url:
        config["thumbnail_upload_url"] = object_store_request_url(thumbnail_url, field="thumbnail_upload_url")
    if dispatch_key:
        config["dispatch_key"] = dispatch_key
    config.update(_filing_choice_config(request))
    config.update(_mail_config(request))
    config.update(_tenant_config(request, organization_id))
    config.update(request.licence_mark())
    if request.project_facts is not None:
        config["project_facts"] = request.project_facts.facts.to_store()
        config["project_status"] = request.project_facts.status
    if request.document_id:
        config["document_id"] = request.document_id
    config.update(_provenance_config(request))
    if request.screening is not None and not request.screening.is_empty:
        config["screening"] = request.screening.model_dump(mode="json")
    if request.extraction_ref:
        config["extraction_paths"] = [DeferredObjectDownload(request.extraction_ref, suffix=".pdf")]
    elif request.preview_ref and request.thumbnail_upload_url:
        config["preview_paths"] = [DeferredObjectDownload(request.preview_ref, suffix=".pdf")]
    return config


def _tenant_config(request: IngestRequest, organization_id: str | None) -> dict[str, str]:
    if not organization_id:
        return {}
    config = {"organization_id": organization_id}
    if request.project_id:
        config["project_id"] = request.project_id
    if request.user_id:
        config["user_id"] = request.user_id
    return config


def _filing_choice_config(request: IngestRequest) -> dict[str, str]:
    choices = {
        "folder_path": (request.folder_path or "").strip(),
        "revision_of": (request.revision_of or "").strip(),
        "document_type": request.document_type or "",
    }
    return {key: value for key, value in choices.items() if value}


def _mail_config(request: IngestRequest) -> dict:
    config: dict = {}
    if request.mail_thread is not None:
        config["source_format"] = MAIL_SOURCE_FORMAT
        config["mail_thread"] = request.mail_thread.model_dump(mode="json")
    if request.mail_origin is not None:
        config["mail_origin"] = request.mail_origin.model_dump(mode="json", exclude_none=True)
    return config


def _dispatch_key(request: IngestRequest) -> str | None:
    if not request.document_id:
        return None
    path = urlparse(request.file_ref).path
    return hashlib.sha256(f"{request.document_id}\0{path}\0{request.collection}".encode()).hexdigest()


_dispatch_slots: dict[str, tuple[asyncio.Lock, int]] = {}


@asynccontextmanager
async def _dispatch_slot(dispatch_key: str | None) -> AsyncIterator[None]:
    if dispatch_key is None:
        yield
        return
    lock, holders = _dispatch_slots.get(dispatch_key, (asyncio.Lock(), 0))
    _dispatch_slots[dispatch_key] = (lock, holders + 1)
    try:
        async with lock:
            yield
    finally:
        lock, holders = _dispatch_slots[dispatch_key]
        if holders <= 1:
            del _dispatch_slots[dispatch_key]
        else:
            _dispatch_slots[dispatch_key] = (lock, holders - 1)


async def _live_job(ingestor: BaseIngestor, dispatch_key: str | None) -> str | None:
    if dispatch_key is None:
        return None
    try:
        found = await asyncio.to_thread(ingestor.find_live_job, dispatch_key)
    except Exception as error:  # noqa: BLE001 - the lookup is an optimisation of a submit
        logger.warning("Live-job lookup failed (submitting): %s", type(error).__name__)
        return None
    return found if isinstance(found, str) and found else None


class DeferredObjectDownload:
    __slots__ = ("_suffix", "_url")

    def __init__(self, url: str, suffix: str | None = None) -> None:
        self._url = url
        self._suffix = suffix

    def __repr__(self) -> str:
        return "<deferred object download>"

    def to_payload(self) -> dict[str, str | None]:
        return {"url": self._url, "suffix": self._suffix}

    @classmethod
    def from_payload(cls, data: dict) -> DeferredObjectDownload:
        url = data["url"]
        assert_fetchable_object_store_url(url)
        return cls(url, data.get("suffix"))

    def __call__(self) -> str:
        response = _get_original(object_store_request_url(self._url))
        response.raise_for_status()
        suffix = self._suffix or _infer_suffix(response.headers.get("content-type", ""), self._url)
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(response.content)
        except BaseException:
            os.unlink(path)
            raise
        logger.info("Downloaded %d bytes for ingestion", len(response.content))
        return path


_DOWNLOAD_TIMEOUT_SECONDS = 60.0
_DOWNLOAD_CONNECT_RETRIES = CONNECT_RETRIES
_DOWNLOAD_CONNECT_TIMEOUT_SECONDS = CONNECT_TIMEOUT_SECONDS
_DOWNLOAD_RESPONSE_ATTEMPTS = 3
_RESPONSE_RETRY_PAUSE_SECONDS = 1.0


def _get_original_once(url: str) -> httpx.Response:
    with httpx.Client(transport=httpx.HTTPTransport(retries=_DOWNLOAD_CONNECT_RETRIES)) as client:
        return client.get(
            url,
            follow_redirects=False,
            timeout=httpx.Timeout(_DOWNLOAD_TIMEOUT_SECONDS, connect=_DOWNLOAD_CONNECT_TIMEOUT_SECONDS),
        )


def _get_original(url: str) -> httpx.Response:
    for _ in range(_DOWNLOAD_RESPONSE_ATTEMPTS - 1):
        try:
            return _get_original_once(url)
        except httpx.RemoteProtocolError, httpx.ReadError:
            time.sleep(_RESPONSE_RETRY_PAUSE_SECONDS)
    return _get_original_once(url)


def _provenance_config(request: IngestRequest) -> dict[str, str]:
    from agent.common.provenance import AGENT_AUTHOR
    from agent.common.provenance import KEY_APPROVED_AT
    from agent.common.provenance import KEY_APPROVED_BY
    from agent.common.provenance import KEY_AUTHORED_BY
    from agent.common.provenance import KEY_PRODUCER
    from agent.common.provenance import is_agent_author

    if not is_agent_author(request.authored_by):
        return {}
    fields = {
        KEY_AUTHORED_BY: AGENT_AUTHOR,
        KEY_APPROVED_BY: (request.approved_by or "").strip(),
        KEY_APPROVED_AT: (request.approved_at or "").strip(),
        KEY_PRODUCER: (request.producer or "").strip(),
    }
    return {key: value for key, value in fields.items() if value}


def _infer_suffix(content_type: str, url: str) -> str:
    content_map = {
        "application/pdf": ".pdf",
        "text/plain": ".txt",
        "text/markdown": ".md",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.ms-word.document.macroenabled.12": ".docm",
        "application/msword": ".doc",
        "application/vnd.ms-excel.sheet.macroenabled.12": ".xlsm",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.ms-powerpoint.presentation.macroenabled.12": ".pptm",
        "application/vnd.ms-powerpoint": ".ppt",
        "application/vnd.oasis.opendocument.text": ".odt",
        "application/vnd.oasis.opendocument.spreadsheet": ".ods",
        "application/vnd.oasis.opendocument.presentation": ".odp",
        "application/rtf": ".rtf",
        "text/rtf": ".rtf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/vnd.dxf": ".dxf",
        "application/dxf": ".dxf",
    }
    suffix = content_map.get(content_type.split(";", maxsplit=1)[0].strip().lower(), "")
    if not suffix:
        suffix = re.sub(r"[^a-zA-Z0-9.]", "", os.path.splitext(urlparse(url).path)[1])[:16]
    return suffix or ".bin"


def _extract_filename(url: str) -> str:
    path = urlparse(url).path
    filename = unquote(os.path.basename(path))
    if not filename or filename == "/":
        return "document"
    return filename
