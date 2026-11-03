"""One page of a file read by a task of its own: the page fan-out's middle step (``INGEST_PAGE_FAN_OUT``, ADR-0151).

:func:`read_page` renders its page from the original (downloaded once per worker,
:func:`local_source`), reads it with the pipeline's own functions, so the vision
cache and the fleet's lease pool still apply, and stores every answer the call
got, keyed as the pipeline asks for it (``step_outputs.page_part``). The
assembly hands those answers to the file's pool (``assembly``), so the write makes
no model call for a page read here.

:func:`vision_settings` is the one resolution of a file's vision endpoint, the
pipeline's (``_ingest_job``) and the page task's, so the two ask with the same
model and the same keys. Free of the orchestrator's SDK.
"""

from __future__ import annotations

import contextlib
import logging
import os
import shutil
import tempfile
import threading
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent.knowledge.page_fan_out_port import PageNotRead as _PageNotRead

from . import step_outputs

logger = logging.getLogger(__name__)

#: What a page needs, as ``extract`` lists it: a transcription (a scan, a garbled page) or a drawing's reading.
TRANSCRIBE = "transcribe"
DRAWING = "drawing"


#: Raised for a page whose task has retries left: the port's, so the orchestrator's layer can catch it.
PageNotRead = _PageNotRead


@dataclass(frozen=True)
class VisionSettings:
    """The vision endpoint a file's page reads use."""

    api_key: str
    base_url: str
    vlm_model: str
    ocr_model: str


def vision_settings(ingestor: Any, config: dict[str, Any]) -> VisionSettings:
    """The organization's key and endpoint (BYOK), its model override, and the OCR model (``OCR_MODEL``)."""
    from . import adapter
    from . import transcription

    organization_id = config.get("organization_id")
    credential = adapter.resolve_vlm_credential(organization_id)
    base_model = config.get("vlm_model", ingestor.vlm_model)
    override = adapter._resolve_vlm_model_override(organization_id)
    return VisionSettings(
        api_key=credential.api_key,
        base_url=config.get("vlm_base_url") or credential.base_url,
        vlm_model=override or base_model,
        ocr_model=transcription.resolve_ocr_model(base_model, override),
    )


@contextlib.contextmanager
def model_call_scope(job_id: str, config: dict[str, Any]) -> Iterator[None]:
    """Where a job's model calls run: its organization's data policy, its cost ledger, its priority.

    Entered by the one-step job (``LlamaIndexIngestor._run_ingestion``) and by each
    page task, so a page read in a task of its own follows the organization's
    zero-data-retention setting (ADR-0074), lands on the job's ``activity = ingest``
    ledger and takes the job's class at the provider limiter (ADR-0081), as it does
    inside the job. No organization (the base corpus) is pinned anyway.
    """
    from agent.common.openrouter import ZERO_DATA_RETENTION
    from agent.common.openrouter import data_policy_for
    from agent.common.openrouter import data_policy_scope
    from agent.common.provider_limiter import priority_scope

    from . import adapter

    organization_id = config.get("organization_id")
    policy = data_policy_for(organization_id) if organization_id else ZERO_DATA_RETENTION
    with (
        data_policy_scope(policy),
        adapter._ingest_cost_scope(job_id, config),
        priority_scope(config.get("priority")),
    ):
        yield


def download(prepared: Any) -> tuple[str | None, list[str]]:
    """The PDF a one-file job is read from (its rendition when it has one) and the files the download wrote."""
    from knowledge_layer.deferred_files import resolve_original
    from knowledge_layer.renditions import resolve_rendition

    downloaded: list[str] = []
    original = resolve_original(prepared.file_paths[0], downloaded)
    if original is None:
        return None, downloaded
    rendition = resolve_rendition(prepared.config, 0, downloaded)
    return rendition or original, downloaded


def delete(paths: list[str]) -> None:
    for path in paths:
        with contextlib.suppress(OSError):
            os.unlink(path)


#: The originals this worker downloaded, by job id, most recent last. A page task
#: renders its page from here, so a worker downloads a file once however many of
#: its pages it reads. Bounded (``_LOCAL_SOURCES_MAX``) and held only on this
#: worker's disk; an evicted entry's file is deleted.
_LOCAL_SOURCES: OrderedDict[str, str] = OrderedDict()
_LOCAL_SOURCES_MAX = 4
_LOCAL_LOCK = threading.Lock()
_JOB_LOCKS: dict[str, threading.Lock] = {}


def local_source(prepared: Any) -> str | None:
    """The job's PDF on this worker's disk, downloaded on the first call for the job."""
    with _LOCAL_LOCK:
        lock = _JOB_LOCKS.setdefault(prepared.job_id, threading.Lock())
    with lock:
        with _LOCAL_LOCK:
            held = _LOCAL_SOURCES.get(prepared.job_id)
            if held is not None and os.path.exists(held):
                _LOCAL_SOURCES.move_to_end(prepared.job_id)
                return held
        source, downloaded = download(prepared)
        if source is None:
            delete(downloaded)
            return None
        # A copy the cache owns: a deferred download hands out a path the job deletes.
        local = str(Path(tempfile.mkdtemp(prefix="ingest-page-")) / "source.pdf")
        shutil.copyfile(source, local)
        delete(downloaded)
        with _LOCAL_LOCK:
            _LOCAL_SOURCES[prepared.job_id] = local
            while len(_LOCAL_SOURCES) > _LOCAL_SOURCES_MAX:
                job, path = _LOCAL_SOURCES.popitem(last=False)
                _JOB_LOCKS.pop(job, None)
                delete([path])
        return local


def _render(source: str, page: int) -> bytes | None:
    """The page as the pipeline renders it (``PAGE_RENDER_MAX_DIM``, JPEG): the same bytes, so the same cache key."""
    from . import adapter
    from . import processing

    doc = processing._open_pdf(source, "Page task render")
    if doc is None:
        return None
    try:
        image = processing._render_numbered_page(doc, page, adapter.PAGE_RENDER_MAX_DIM, source)
    finally:
        processing._close_pdf(doc)
    return None if image is None else processing._encode_jpeg(image)[0]


def _read(image: bytes, kind: str, vision: VisionSettings, extract_charts: bool) -> bool:
    """Read one rendered page as the pipeline would; whether it was read.

    A scan the transcription calls a drawing is read as a drawing too, as the pipeline then would.
    """
    from . import adapter
    from . import processing
    from . import transcription

    if kind == TRANSCRIBE:
        reply = transcription.transcribe_image(
            image, model=vision.ocr_model, base_url=vision.base_url, api_key=vision.api_key
        )
        if transcription.is_failed(reply):
            return False
        if not reply.startswith(transcription.DRAWING_MARKER):
            return True
    _content_type, caption, _fields = adapter.analyze_visual(
        image,
        vlm_model=vision.vlm_model,
        vlm_base_url=vision.base_url,
        vlm_api_key=vision.api_key,
        extract_charts=extract_charts,
    )
    return not processing.is_failed_caption(caption)


def read_page(ingestor: Any, prepared: Any, *, page: int, kind: str, content_hash: str, final: bool) -> dict[str, Any]:
    """One page. Raises ``PageNotRead`` while ``final`` is false; on the last attempt records the page unread.

    What the call got is stored whether or not it was read: a failure the page
    task stores is the failure the assembly counts in the file's coverage
    (``transcription_failed``, ``vision_failed``), without asking the model again.
    Returns references and counts only.
    """
    from . import page_reads

    config = ingestor._job_config(prepared)
    source = local_source(prepared)
    image = _render(source, page) if source else None
    answers: dict[str, Any] = {}
    if image is None:
        read, reason = False, "render_failed"
    else:
        charts = bool(config.get("extract_charts", ingestor.extract_charts))
        with model_call_scope(prepared.job_id, config), page_reads.file_page_reads(1) as reads:
            read = _read(image, kind, vision_settings(ingestor, config), charts)
            answers = dict(reads.answers)
        reason = None if read else "model_failed"
    if reason and not final:
        raise PageNotRead(reason)
    record = {"page": page, "kind": kind, "read": read, "reason": reason, "answers": answers}
    stored = step_outputs.for_job(prepared, content_hash).put(step_outputs.page_part(page), record)
    return {"page": page, "read": read, "reason": reason, "stored": stored}
