"""
LlamaIndex adapter for the Knowledge Layer.

It uses:
- LlamaIndex's document loaders and chunking (``SentenceSplitter``)
- Embeddings via LlamaIndex's `NVIDIAEmbedding` client pointed at an OpenAI-compatible endpoint (OpenRouter by default)
- Qdrant for every chunk, written and read through ``knowledge_layer.vector_store`` (ADR-0115)
- Optional multimodal extraction (tables, charts, images) with VLM captioning through the same endpoint

Configuration options:
    embed_model: Embedding model (default: openai/text-embedding-3-large, 3072-d, via EMBED_MODEL)
    embed_base_url: Embedding model base URL (default: https://openrouter.ai/api/v1)
    chunk_size: Chunk size for text splitting (default: 1024)
    chunk_overlap: Overlap between chunks (default: 128)

Multimodal options:
    extract_tables: Enable table extraction via pdfplumber (default: True)
    extract_charts: Enable chart extraction with VLM data extraction (default: True)
    extract_images: Enable image extraction with VLM captioning (default: True)
    vlm_model: VLM model for captioning (default: openai/gpt-6-luna)
    vlm_base_url: VLM model base URL (default: https://openrouter.ai/api/v1)

Chart extraction uses the VLM to:
1. Classify images as charts/graphs vs regular images
2. Extract structured data (chart type, axis labels, data points, trends)
"""

import base64
import contextlib
import dataclasses
import hashlib
import itertools
import json
import logging
import os
import re
import threading
import time
import uuid
from collections.abc import Callable
from collections.abc import Iterator
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime
from pathlib import Path
from typing import Any
from typing import NamedTuple

from knowledge_layer import dependencies
from knowledge_layer import embedding
from knowledge_layer.dependencies import retrieval_dependency_error
from knowledge_layer.embedding import EMBED_BATCH_SIZE
from knowledge_layer.embedding import EMBED_MAX_RETRIES
from knowledge_layer.embedding import EMBED_TIMEOUT_SECONDS
from knowledge_layer.embedding import embed_fingerprint_metadata
from knowledge_layer.env import env_float
from knowledge_layer.env import env_int
from knowledge_layer.env import env_switch
from knowledge_layer.ingest.listing import LISTING_FIELDS
from knowledge_layer.ingest.listing import files_from_payloads
from knowledge_layer.ingest.listing import from_epoch

from agent.common.connect_retry import connect_retrying_client
from agent.knowledge import ingest_status_store
from agent.knowledge.base import BaseIngestor
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.base import TTLCleanupMixin
from agent.knowledge.factory import register_ingestor
from agent.knowledge.schema import CollectionInfo
from agent.knowledge.schema import FileInfo
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent.knowledge.schema import QuarantineVerdict
from agent.knowledge.schema import stable_file_id

from . import chosen_document_type
from . import filed_mail
from . import revisions
from . import row_facts
from .chunk_metadata import provenance_from_config
from .chunk_metadata import stamp_chunk_metadata
from .chunking_choice import is_released_text as _released
from .chunking_choice import text_documents_for_pages
from .chunking_choice import text_documents_for_pages as _chunk
from .measures import INGEST_TRACE_NAME  # noqa: F401 - re-exported, the trace's name
from .measures import file_trace as _file_trace
from .measures import finish_file as _finish_file_trace
from .pdf_text import _WATERMARK_PHRASES  # noqa: F401 - the text pass moved to pdf_text; these stay reachable here
from .pdf_text import PDF_PAGE_MAX_OBJECTS  # noqa: F401
from .pdf_text import WATERMARK_LINE_PATTERNS  # noqa: F401
from .pdf_text import PdfTextPages  # noqa: F401
from .pdf_text import _dense_page_entry  # noqa: F401
from .pdf_text import _dense_page_text  # noqa: F401
from .pdf_text import _dense_page_texts  # noqa: F401
from .pdf_text import _extract_text_from_pdf  # noqa: F401
from .pdf_text import _inside_any  # noqa: F401
from .pdf_text import _raster_count  # noqa: F401
from .pdf_text import _read_pdf_page  # noqa: F401
from .pdf_text import _strip_watermark_lines  # noqa: F401
from .pdf_text import unreadable_pdf_verdict  # noqa: F401
from .pdfium_lock import close_bitmap
from .pdfium_lock import detached_pil
from .pdfium_lock import pdfium_lock
from .vision_calls import VISION_GENERATION_NAME  # noqa: F401 - re-exported, the generation's name
from .vision_calls import VLM_FLEET_CONCURRENCY  # noqa: F401 - re-exported
from .vision_calls import VLM_RATE_LIMIT_RETRIES  # noqa: F401 - re-exported
from .vision_calls import VLM_REQUEST_TIMEOUT_SECONDS  # noqa: F401 - re-exported
from .vision_calls import _observed_vlm_call  # noqa: F401 - re-exported
from .vision_calls import _vlm_chat_create
from .vision_calls import _vlm_client

logger = logging.getLogger(__name__)


DEFAULT_VLM_MODEL = os.environ.get("VLM_MODEL", "openai/gpt-6-luna")
DEFAULT_VLM_BASE_URL = os.environ.get("VLM_BASE_URL", "https://openrouter.ai/api/v1")


MIN_IMAGE_WIDTH_PX = 100
MIN_IMAGE_HEIGHT_PX = 100

MAX_IMAGES_PER_DOCUMENT = env_int("MAX_IMAGES_PER_DOCUMENT", 64, minimum=0)

MAX_IMAGE_PIXELS = env_int("MAX_IMAGE_PIXELS", 268_435_456, minimum=0)

VLM_MAX_IMAGE_DIM = 1568


RENDER_VISUAL_PAGES = os.environ.get("RENDER_VISUAL_PAGES", "true").lower() == "true"

PAGE_RENDER_MAX_DIM = env_int("PAGE_RENDER_MAX_DIM", 2048)

VISUAL_PAGE_MIN_TEXT_CHARS = env_int("VISUAL_PAGE_MIN_TEXT_CHARS", 200, minimum=0)
VISUAL_PAGE_MIN_PATHS = env_int("VISUAL_PAGE_MIN_PATHS", 300, minimum=0)
MAX_RENDERED_PAGES = env_int("MAX_RENDERED_PAGES", 20, minimum=0)

MAX_OCR_PAGES = env_int("MAX_OCR_PAGES", 500, minimum=0)


_PAGEOBJ_TEXT = 1
_PAGEOBJ_PATH = 2
_PAGEOBJ_IMAGE = 3

COLLECTION_TTL_HOURS = env_float("COLLECTION_TTL_HOURS", 24.0)

TTL_CLEANUP_INTERVAL_SECONDS = env_int("TTL_CLEANUP_INTERVAL_SECONDS", 3600)

JOB_RETENTION_SECONDS = 3600  # 1 hour

PERMIT_RECORD_TIMEOUT_SECONDS = 90
PAGE_TEXT_TIMEOUT_SECONDS = 30


DOSSIER_TIMEOUT_SECONDS = 60
PERMIT_RECORD_DROP_TIMEOUT_SECONDS = 5
REVISION_TIMEOUT_SECONDS = 45

DOCUMENT_DELETED_DURING_INGEST = "document_deleted: the document was deleted while it was being ingested"
SCREENING_UNAVAILABLE = (
    "screening_unavailable: the screening policy in this job could not be applied; nothing of the file was read"
)


class _ClaimLost(Exception):  # noqa: N818 - a signal, not an error
    """The job's run was stopped (cancelled, or out of time); this run must write nothing more."""


FILE_TRACKING_RETENTION_SECONDS = env_int("FILE_TRACKING_RETENTION_SECONDS", 86400)  # 24h

_PRUNE_EVERY_BEATS = 120


def bump_collection_version(collection_name: str) -> None:
    """Record a write so every replica's cached results for this collection stop matching."""
    from agent.knowledge import collection_version as _collection_version

    _collection_version.bump(collection_name)


def resolve_vlm_credential(organization_id: str | None = None):
    """Resolve the full VLM credential (key + base URL + model) — the single
    source of truth for the vision endpoint ingestion will call.

    Delegates to the shared resolver (:func:`resolve_llm_credential`) so the VLM
    inherits the SAME resolution the agent runtime's chat models use, including **BYOK**:

      0. **BYOK** — when ``organization_id`` is given and the org has a
         bring-your-own credential, the org's key + base URL win (never the
         model — mirrors ADR-0022/0014).
      1. explicit override           — ``VLM_API_KEY``
      2. deployment provider key     — inferred from ``VLM_BASE_URL``
         (``OPENROUTER_API_KEY`` for the default OpenRouter host)

    Passing ``organization_id`` is what makes per-project/Archiv uploads use the
    tenant's own key + endpoint; the org-agnostic paths (base OIB corpus sync)
    pass ``None`` and get the deployment default, unchanged.
    """
    from agent.common.credential_resolution import resolve_llm_credential

    return resolve_llm_credential(
        primary_env="VLM_API_KEY",
        default_base_url=DEFAULT_VLM_BASE_URL,
        default_model=DEFAULT_VLM_MODEL,
        base_url_env="VLM_BASE_URL",
        model_env="VLM_MODEL",
        organization_id=organization_id,
    )


def _resolve_vlm_model_override(organization_id: str | None) -> str | None:
    """The org's runtime model override for the ingestion VLM, or ``None``.

    Mirrors the agent runtime's chat models' ``x-grid-model-overrides`` behaviour for the
    ``ingest_vlm`` agent group (ADR-0014), resolved by org id via the BFF's
    internal endpoint (the ingest thread has no request header). Model selection
    only — the key + base URL still come from BYOK/env. Fail-open to ``None`` so
    a BFF hiccup never blocks ingestion.
    """
    if not organization_id:
        return None
    try:
        from agent.common.model_overrides import AgentGroup
        from agent.common.model_overrides import resolve_org_model_overrides

        return resolve_org_model_overrides(organization_id).get(AgentGroup.INGEST_VLM.value)
    except Exception:  # noqa: BLE001 - model selection must never take ingestion down
        logger.warning("VLM model-override resolution failed for org %s", organization_id, exc_info=True)
        return None


def resolve_vlm_api_key() -> str:
    """Resolve the (org-agnostic) VLM API key — the single source of truth for
    "is a vision model reachable?".

    Both the capability endpoint that tells the frontend whether to offer image
    upload and the org-agnostic ingestion gate consult this. Per-request
    ingestion resolves the org-aware credential via
    :func:`resolve_vlm_credential` instead, so a tenant's BYOK key powers its
    own uploads. Returns the resolved key, or ``""`` when none is configured.
    """
    return resolve_vlm_credential(organization_id=None).api_key


def vlm_configured() -> bool:
    """Whether a VLM API key resolves — i.e. image ingestion can run here.

    Derived capability (never a standalone flag): it reflects exactly what
    ``resolve_vlm_api_key`` finds, so extending the resolution chain lights up
    the frontend's image-upload offer automatically.
    """
    return bool(resolve_vlm_api_key())


def _get_vlm_api_key() -> str:
    """Back-compat alias for the ingestion path; delegates to the single source
    of truth in :func:`resolve_vlm_api_key`."""
    return resolve_vlm_api_key()


_PAGEOBJ_IMAGE = 3


def _extract_images_from_pdf(
    pdf_path: str,
    min_width: int = MIN_IMAGE_WIDTH_PX,
    min_height: int = MIN_IMAGE_HEIGHT_PX,
    skip_pages: set[int] | frozenset[int] = frozenset(),
) -> list[dict[str, Any]]:
    """
    Extract images from a PDF file using PyPDFium2.

    Args:
        pdf_path: Path to the PDF file.
        min_width: Minimum image width to extract (filters out icons/logos).
        min_height: Minimum image height to extract.
        skip_pages: 1-based pages whose rasters are not extracted, because the
            whole page is rendered and analysed as a visual page already. A
            scanned page is one full-page raster; without this it was analysed
            twice, once as that raster and once as the rendered page.

    Uncapped in the number of rasters, but every raster is still held to
    ``MAX_IMAGE_PIXELS``: the pixel budget bounds one decode, which no caller can
    raise.

    Returns:
        List of dicts with 'image_bytes', 'page_number', 'image_index', 'format'.
    """
    records, _, _ = _extract_image_records(
        pdf_path,
        min_width=min_width,
        min_height=min_height,
        skip_pages=skip_pages,
        max_images=None,
        max_pixels=MAX_IMAGE_PIXELS,
    )
    return records


def _extract_image_records(
    pdf_path: str,
    *,
    min_width: int,
    min_height: int,
    skip_pages: set[int] | frozenset[int],
    max_images: int | None,
    max_pixels: int,
) -> tuple[list[dict[str, Any]], int, int]:
    """Embedded rasters worth analysing, the cap's left-outs, and the oversized refusals.

    Two passes, because only the second one costs memory. The first reads every
    image object's pixel size from metadata, decoding nothing, and applies the
    per-document cap and the per-raster pixel budget there -- so an image that
    will not be analysed, and an image too large to decode safely, never cost a
    bitmap. The second decodes the survivors, one at a time: pypdfium2 cannot
    downscale an embedded image on decode, so each raster's full-resolution
    bitmap exists for one image, is downscaled from a zero-copy view, and is
    freed before the next. Peak memory is flat in the number of rasters and in
    the length of the document, and bounded above by ``max_pixels``, which is
    what keeps an ingest pod inside its limit instead of being OOM-killed by a
    plan set.

    The same raster embedded repeatedly is captioned and indexed once: the
    content hash still dedupes the records, after the cap.

    Returns ``(records, over_cap, over_pixel_budget)``.
    """
    try:
        import pypdfium2 as pdfium
    except ImportError:
        logger.warning("pypdfium2 not installed. Install with: pip install pypdfium2")
        return [], 0, 0

    records: list[dict[str, Any]] = []
    over_cap = 0
    over_pixel_budget = 0
    seen_hashes: set[str] = set()
    try:
        with pdfium_lock():
            doc = pdfium.PdfDocument(pdf_path)
            page_count = len(doc)
        try:
            candidates: list[dict[str, Any]] = []
            for page_num in range(page_count):
                if page_num + 1 in skip_pages:
                    continue
                page_candidates, page_over_budget = _image_candidates(
                    doc, page_num, min_width, min_height, max_pixels=max_pixels, pdf_path=pdf_path
                )
                candidates.extend(page_candidates)
                over_pixel_budget += page_over_budget
            if max_images is None:
                kept = candidates
            else:
                kept, over_cap = cap_images(candidates, max_images)
            _log_memory(f"rasters:start kept={len(kept)} over_cap={over_cap} over_pixel_budget={over_pixel_budget}")
            for page_number, page_candidates in _candidates_by_page(kept):
                records.extend(_decode_page_candidates(doc, page_number, page_candidates, seen_hashes))
            _log_memory(f"rasters:done kept={len(kept)}")
        finally:
            with pdfium_lock():
                doc.close()
        logger.info(
            "Extracted %d images from %s (%d candidates, %d over cap, %d over the pixel budget)",
            len(records),
            pdf_path,
            len(candidates),
            over_cap,
            over_pixel_budget,
        )

    except Exception as e:
        logger.error(f"Error extracting images from PDF: {e}")

    return records, over_cap, over_pixel_budget


def _image_candidates(
    doc: Any, page_num: int, min_width: int, min_height: int, *, max_pixels: int, pdf_path: str
) -> tuple[list[dict[str, Any]], int]:
    """One page's image objects that clear both metadata filters, and how many the pixel budget refused.

    ``image_index`` counts every image object on the page, kept or not. No pixels
    are touched here: ``_image_pixel_size`` asks the library for the size, which
    is what lets the icon filter AND the pixel budget run before a single raster
    is allocated. A raster whose ``width x height`` is over ``max_pixels`` is
    refused and warned about; the only way to bound a decode pypdfium2 will not
    scale is never to start it.
    """
    candidates: list[dict[str, Any]] = []
    over_budget = 0
    with pdfium_lock():
        page = doc[page_num]
        try:
            for img_idx, obj in enumerate(_image_objects(page)):
                try:
                    width, height = _image_pixel_size(obj)
                except Exception as e:
                    logger.debug(f"Could not size image {img_idx} on page {page_num}: {e}")
                    continue
                if width < min_width or height < min_height:
                    continue
                pixels = width * height
                if pixels > max_pixels:
                    over_budget += 1
                    logger.warning(
                        "Refusing to decode %dx%d px (%d MP) image %d on page %d of %s: over the "
                        "%d MP per-raster budget (MAX_IMAGE_PIXELS); the page's text is still indexed",
                        width,
                        height,
                        pixels // 1_000_000,
                        img_idx,
                        page_num + 1,
                        pdf_path,
                        max_pixels // 1_000_000,
                    )
                    continue
                candidates.append(
                    {"page_number": page_num + 1, "image_index": img_idx, "width": width, "height": height}
                )
        finally:
            page.close()
    return candidates, over_budget


def _image_pixel_size(obj: Any) -> tuple[int, int]:
    """An image object's pixel size, read from metadata wherever the library offers it.

    ``PdfImage.get_px_size`` returns the dimensions without decoding a pixel --
    the whole point of the two-pass extraction, since a decode allocates the
    full-resolution raster. An image (or a library) that cannot answer costs one
    decode, exactly as every image used to.
    """
    get_px_size = getattr(obj, "get_px_size", None)
    if get_px_size is not None:
        try:
            width, height = get_px_size()
            return int(width), int(height)
        except Exception as e:  # noqa: BLE001 - any metadata failure falls back to a decode
            logger.debug(f"Image metadata unreadable ({e}); decoding it to size it")
    bitmap = obj.get_bitmap()
    try:
        return bitmap.width, bitmap.height
    finally:
        close_bitmap(bitmap)


def _image_objects(page: Any) -> list[Any]:
    """The page's image XObjects, in the order ``image_index`` counts them."""
    return [obj for obj in page.get_objects() if obj.type == _PAGEOBJ_IMAGE]


def _candidates_by_page(candidates: list[dict[str, Any]]) -> list[tuple[int, list[dict[str, Any]]]]:
    """Candidates grouped by 1-based page, pages in order."""
    grouped: dict[int, list[dict[str, Any]]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate["page_number"], []).append(candidate)
    return sorted(grouped.items())


def _decode_page_candidates(
    doc: Any, page_number: int, candidates: list[dict[str, Any]], seen_hashes: set[str]
) -> list[dict[str, Any]]:
    """One page's capped rasters as JPEG records, decoded one at a time.

    The lock is taken per raster and released before the JPEG is encoded, so a
    full-resolution bitmap lives for the shortest possible window and the other
    documents on the pod are not held behind it.
    """
    records: list[dict[str, Any]] = []
    with pdfium_lock():
        page = doc[page_number - 1]
    try:
        with pdfium_lock():
            objects = _image_objects(page)
        for candidate in candidates:
            try:
                with pdfium_lock():
                    image = _downscaled_raster(objects[candidate["image_index"]])
            except Exception as e:
                logger.debug(f"Could not extract image {candidate['image_index']} from page {page_number}: {e}")
                continue
            record = _raster_record(
                image,
                page_number,
                candidate["image_index"],
                (candidate["width"], candidate["height"]),
                seen_hashes,
            )
            if record is not None:
                records.append(record)
    finally:
        with pdfium_lock():
            page.close()
    return records


def _downscaled_raster(obj: Any) -> Any:
    """An image object as a PIL image whose longest edge is at most ``VLM_MAX_IMAGE_DIM``.

    Runs under the PDFium lock and returns an image that owns its pixels.
    ``PdfBitmap.to_pil`` is a view over the bitmap's buffer, so the downscale
    allocates only the bounded result; an image already within bounds is
    detached explicitly. Either way the full-resolution bitmap is closed before
    this returns, and with it the pixels.
    """
    bitmap = obj.get_bitmap()
    try:
        image = bitmap.to_pil()
        size = image.size
        image.thumbnail((VLM_MAX_IMAGE_DIM, VLM_MAX_IMAGE_DIM))
        if image.size == size:
            image = image.copy()
        return image
    finally:
        close_bitmap(bitmap)


def _rss_mib() -> float | None:
    """This process's resident set size in MiB, or None where that is not readable."""
    try:
        with open("/proc/self/statm", encoding="ascii") as statm:
            resident_pages = int(statm.read().split()[1])
        page_size = os.sysconf("SC_PAGE_SIZE")
    except OSError, ValueError, IndexError, AttributeError:
        return None
    return resident_pages * page_size / (1024 * 1024)


def _log_memory(stage: str) -> None:
    """One line per ingest phase: the phase, and what the process is holding.

    The worker's memory used to grow with the document -- every embedded raster
    decoded to full resolution and kept until the file ended -- and pods were
    OOM-killed at the visual-analysis phase. These lines are how a bound is
    proved rather than assumed, and what a regression gets measured against.
    """
    rss = _rss_mib()
    if rss is None:
        return
    logger.info("[ingest-mem] %s rss=%.0fMiB", stage, rss)


def _release_memory(file_name: str) -> None:
    """Hand a finished file's memory back to the OS, and log what the process still holds.

    pdfplumber's parsed pages sit in reference cycles, so leaving its ``with``
    block frees nothing until the cycle collector runs, and glibc keeps what
    is freed in its arenas. Measured on eight CAD sheets: 878 MiB after the
    text pass, 583 MiB after ``gc.collect()``, 354 MiB after ``malloc_trim``.
    Without it a worker carried a 726-page file's 7.2 GiB into the next file
    (2026-10-19). Linux/glibc only; elsewhere the collect alone runs.
    """
    import ctypes
    import gc

    gc.collect()
    with contextlib.suppress(OSError, AttributeError):
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    _log_memory(f"file:released {file_name}")


def _raster_record(
    pil_image: Any, page_number: int, img_idx: int, size: tuple[int, int], seen_hashes: set[str]
) -> dict[str, Any] | None:
    """One extracted raster as a JPEG record, or None when an identical one was already kept."""
    import io

    pil_image.thumbnail((VLM_MAX_IMAGE_DIM, VLM_MAX_IMAGE_DIM))
    buf = io.BytesIO()
    pil_image.save(buf, format="JPEG", quality=95)
    image_bytes = buf.getvalue()
    digest = hashlib.sha256(image_bytes).hexdigest()
    if digest in seen_hashes:
        return None
    seen_hashes.add(digest)
    width, height = size
    return {
        "image_bytes": image_bytes,
        "page_number": page_number,
        "image_index": img_idx,
        "format": "jpeg",
        "width": width,
        "height": height,
    }


def _render_first_pdf_page(pdf_path: str, *, scale: float, max_dim: int = PAGE_RENDER_MAX_DIM) -> Any:
    """Page 1 of ``pdf_path`` as a PIL image that owns its pixels, rendered under the PDFium lock.

    ``scale`` is an upper bound, not the render scale: the long edge is clamped
    to ``max_dim``. The caller makes a 400 px thumbnail of this, and a fixed
    scale of 2 renders an A0 sheet at ~6740 px -- ~100 MB of pixels, copied a
    second time to leave the lock -- to throw nearly all of it away. Ordinary
    sheets are far under the clamp and render exactly as before.
    """
    import pypdfium2 as pdfium

    with pdfium_lock():
        pdf = pdfium.PdfDocument(pdf_path)
        try:
            page = pdf[0]
            try:
                width_pt, height_pt = page.get_size()
                longest_pt = max(width_pt, height_pt) or 1.0
                render_scale = min(scale, max_dim / longest_pt)
                return detached_pil(page.render(scale=render_scale))
            finally:
                page.close()
        finally:
            pdf.close()


def cap_images(images: list[dict[str, Any]], max_images: int) -> tuple[list[dict[str, Any]], int]:
    """Keep at most ``max_images`` rasters for VLM analysis; ``(kept, left_out)``.

    Largest first, by original pixel area: past the cap a document is
    image-heavy (a photo documentation, a scanned appendix), and the small
    rasters that survive the icon filter are stamps, logos and thumbnails,
    while the large ones carry the content. Page order would spend the whole
    budget on the first pages and read nothing of the rest. The kept rasters
    come back in document order, so stored-image indices stay stable.
    """
    if len(images) <= max_images:
        return images, 0
    by_size = sorted(images, key=lambda image: image.get("width", 0) * image.get("height", 0), reverse=True)
    kept = sorted(by_size[:max_images], key=lambda image: (image["page_number"], image["image_index"]))
    return kept, len(images) - len(kept)


def _embedded_images_for_analysis(
    pdf_path: str, *, rendered_pages: set[int], enabled: bool
) -> tuple[list[dict[str, Any]], int, int]:
    """The embedded rasters worth a VLM call, the cap's left-outs, and the oversized refusals.

    Each page is analysed once: a page rendered whole as a visual page carries
    its rasters in the render, so none are extracted from it. What remains is
    capped at ``MAX_IMAGES_PER_DOCUMENT`` and refuses any single raster over
    ``MAX_IMAGE_PIXELS``.
    """
    if not enabled:
        return [], 0, 0
    images, over_cap, over_pixel_budget = _extract_image_records(
        pdf_path,
        min_width=MIN_IMAGE_WIDTH_PX,
        min_height=MIN_IMAGE_HEIGHT_PX,
        skip_pages=rendered_pages,
        max_images=MAX_IMAGES_PER_DOCUMENT,
        max_pixels=MAX_IMAGE_PIXELS,
    )
    if over_cap:
        logger.warning(
            "%s holds %d embedded images; analysing the %d largest, %d not indexed",
            pdf_path,
            len(images) + over_cap,
            len(images),
            over_cap,
        )
    if over_pixel_budget:
        logger.warning(
            "%s holds %d embedded image(s) over the %d MP per-raster budget; refused before decoding",
            pdf_path,
            over_pixel_budget,
            MAX_IMAGE_PIXELS // 1_000_000,
        )
    return images, over_cap, over_pixel_budget


def indexed_visual_type(content_type: str, *, extract_images: bool, extract_charts: bool) -> str | None:
    """The chunk type an analysed embedded raster is indexed as; ``None`` drops it.

    The analysis is paid for before this runs, so a switch decides how a visual
    is typed, never whether a chart the VLM found is thrown away while images
    are on. ``extract_charts`` off indexes a chart as an image, the type the
    descriptive prompt would have given it. ``extract_images`` off keeps charts
    only, which is what that switch asks for.
    """
    if content_type == "chart":
        if extract_charts:
            return "chart"
        return "image" if extract_images else None
    return content_type if extract_images else None


def _table_pass_skips(dense_pages: Sequence[int], triage: Any, *, vision_reads: bool) -> list[int]:
    """The pages the table pass does not look at: the dense ones, and the drawings the vision model reads.

    On a vector drawing, every wall and dimension line is an edge to pdfplumber's
    table finder: measured at 0.68 s a page on a sheet of 8000 segments, which finds
    no table, and production's 133-page set spent 125 s here before its first model
    call. A drawing page within the render cap is read whole by the vision model,
    a table drawn on the sheet included, so it is skipped here. A drawing past the
    cap, or any drawing when no vision model reads them, keeps the table pass. Pure.
    """
    skip = set(dense_pages)
    if vision_reads and triage is not None:
        skip.update(sorted(triage.drawings)[:MAX_RENDERED_PAGES])
    return sorted(skip)


def _extract_tables_from_pdf(
    pdf_path: str, taken: dict[int, list[tuple]] | None = None, skip_pages: Sequence[int] = ()
) -> list[dict[str, Any]]:
    """
    Extract tables from a PDF file using pdfplumber.

    Args:
        pdf_path: Path to the PDF file.
        taken: Per page number, the bboxes of the tables the text pass already
            indexed as captioned tables (``_extract_text_from_pdf``'s
            ``table_boxes``). Those are skipped: indexed again here, every OIB
            table stood in the index twice, as „Tabelle 3" and as
            „[TABLE from page 30]", under two competing citations.
        skip_pages: 1-based pages not to look at, the text pass's
            ``dense_pages``: a table finder over hundreds of thousands of
            edges is the cost the page ceiling exists to refuse. Every page
            is closed once read, for the reason ``_extract_text_from_pdf`` gives.

    Returns:
        List of dicts with 'table_text' (markdown), 'page_number', 'table_index'.
    """
    taken = taken or {}
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed. Install with: pip install pdfplumber")
        return []

    tables = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            skipped = set(skip_pages)
            for page_num, page in enumerate(pdf.pages):
                if page_num + 1 in skipped:
                    continue
                try:
                    tables.extend(_page_tables(page, page_num, taken.get(page_num + 1) or []))
                finally:
                    page.close()

        logger.info(f"Extracted {len(tables)} tables from {pdf_path}")

    except Exception as e:
        logger.error(f"Error extracting tables from PDF: {e}")

    return tables


def _page_tables(page: Any, page_num: int, skip: list[tuple]) -> list[dict[str, Any]]:
    """The uncaptioned tables on one pdfplumber page (0-based ``page_num``), minus the ``skip`` boxes."""
    tables = []
    for table_idx, found in enumerate(page.find_tables()):
        if tuple(found.bbox) in skip:
            continue
        table = found.extract()
        if not table or len(table) < 2:  # a header and at least one row
            continue
        markdown = _table_to_markdown(table)
        if markdown:
            tables.append(
                {
                    "table_text": markdown,
                    "cells": table,
                    "page_number": page_num + 1,
                    "table_index": table_idx,
                    "rows": len(table),
                    "cols": len(table[0]),
                }
            )
    return tables


WATERMARK_PHRASE_PATTERNS = [re.compile(fragment, re.IGNORECASE) for fragment, _suffix in _WATERMARK_PHRASES]


def _scrub_watermark_phrases(text: str | None) -> str:
    """Scrub CAD licence/watermark phrases from a VLM caption wherever they
    appear (not only on their own line) so they can never leak into a document
    summary.

    The line-level ``_strip_watermark_lines`` only drops whole watermark lines;
    a caption that mentions "VECTORWORKS EDUCATIONAL VERSION" mid-sentence slips
    straight through it and, when LLM summarisation is off/failed, becomes the
    summary verbatim. This runs on the caption before that can happen. Fail-open:
    returns ``""`` for falsy input and never raises; on any error it returns the
    stripped original rather than losing the caption entirely.
    """
    if not text:
        return ""
    try:
        scrubbed = text
        for pattern in WATERMARK_PHRASE_PATTERNS:
            scrubbed = pattern.sub(" ", scrubbed)
        scrubbed = re.sub(r"[^\S\n]+", " ", scrubbed)
        lines = [line.strip() for line in scrubbed.splitlines()]
        return "\n".join(line for line in lines if line).strip()
    except Exception:  # pragma: no cover - defensive, never break ingestion
        return text.strip()


DEFAULT_CHUNK_SIZE = 1024
DEFAULT_CHUNK_OVERLAP = 128


def split_documents(documents: list[Any], *, chunk_size: int, chunk_overlap: int) -> list[Any]:
    """``documents`` cut into the nodes ingestion stores, in file order: the job's ``SentenceSplitter``. Pure."""
    from llama_index.core.node_parser import SentenceSplitter

    return SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap).get_nodes_from_documents(documents)


def text_chunks_for_pages(
    text_pages: list[dict[str, Any]],
    file_name: str,
    file_size: int,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    doc_class: Any = None,
) -> list[Any]:
    """The text chunks one PDF's pages become, cut the way an ingest job cuts them, before any embedding.

    :func:`text_documents_for_pages`, the job's metadata stamp and :func:`split_documents`, in that
    order: overlap, breadcrumbs, ``page_end`` and ``section_part`` exactly as stored. A node's index in
    the list is its ``chunk_ordinal``. What a fixture seeds, so a test sees what production stores
    (``scripts/turn_census/fixture_files.py``).
    """
    documents = text_documents_for_pages(text_pages, file_name, file_size)
    stamp_chunk_metadata(documents, doc_class=doc_class, provenance={}, chunk_size=chunk_size, file_name=file_name)
    return split_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def page_texts_for_visual_heuristic(text_pages: list[dict[str, Any]]) -> dict[int, str]:
    """Page number to the page's full text, captioned tables included, for the visual-page check.

    ``text`` has its captioned tables cut out. A page that is mostly a table then
    fell under ``VISUAL_PAGE_MIN_TEXT_CHARS``, was rendered and captioned by the VLM
    as a drawing, and competed in the index with the table's own chunks (oib-rl_2
    pages 29, 31, 33, 34). A table is text, so it counts as text here.
    """
    from knowledge_layer.ingest.captioned_tables import page_text_with_tables

    return {page["page_number"]: page_text_with_tables(page["text"], page.get("tables") or []) for page in text_pages}


def _looks_like_pdf(file_path: str) -> bool:
    """Detect PDFs by file magic so presigned/temp files without .pdf still use PDF extraction."""
    try:
        with open(file_path, "rb") as handle:
            return handle.read(5) == b"%PDF-"
    except OSError:
        return False


def _looks_like_image(file_path: str) -> str | None:
    """Detect standalone PNG/JPEG/WebP images by file magic (mirrors _looks_like_pdf).

    Returns the normalized format ("png"/"jpeg"/"webp") or None. Standalone
    images must be routed to VLM captioning; without this they slip through to
    SimpleDirectoryReader, which UTF-8-garbles the binary and is then rejected by
    the binary-content guard. The signatures are specific enough (8-byte PNG,
    3-byte JPEG SOI, RIFF????WEBP) that text/PDF inputs never false-positive.
    """
    try:
        with open(file_path, "rb") as handle:
            header = handle.read(12)
    except OSError:
        return None
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "webp"
    return None


def _read_image_as_jpeg(file_path: str, file_name: str) -> tuple[bytes, int, int] | None:
    """Decode a standalone image and re-encode it as a VLM-ready JPEG.

    Returns ``(jpeg_bytes, original_width, original_height)`` or ``None`` when
    the bytes cannot be decoded (corrupt/unsupported). Re-encodes to JPEG (RGB)
    for a uniform VLM payload, exactly like the PDF-embedded-image path
    (``_extract_images_from_pdf``), downscaling the longest edge to
    ``VLM_MAX_IMAGE_DIM`` (aspect preserved, never upscaled); the ORIGINAL
    dimensions are what the caller records in metadata.
    """
    import io

    from PIL import Image
    from PIL import ImageOps

    try:
        with open(file_path, "rb") as handle:
            raw = handle.read()
        with Image.open(io.BytesIO(raw)) as opened:
            opened.load()
            pil_image = ImageOps.exif_transpose(opened)
            width, height = pil_image.size
            rgb_image = pil_image.convert("RGB")
            rgb_image.thumbnail((VLM_MAX_IMAGE_DIM, VLM_MAX_IMAGE_DIM))
            buf = io.BytesIO()
            rgb_image.save(buf, format="JPEG", quality=95)
            return (buf.getvalue(), width, height)
    except Exception as e:
        logger.error("Could not decode standalone image %s: %s", file_name, e)
        return None


def _build_image_caption_document(
    file_path: str,
    file_name: str,
    file_size: int,
    image_format: str,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    extract_charts: bool = True,
    vlm_api_key: str | None = None,
):
    """Read a standalone image, validate/normalize via PIL, and VLM-caption it.

    Returns a single caption ``Document`` shaped exactly like the PDF-embedded
    image documents (page_label "1", image_index 0), or ``None`` when the bytes
    cannot be decoded as an image (corrupt/unsupported) so the caller can fail
    the file cleanly instead of crashing the job.
    """
    from llama_index.core import Document

    decoded = _read_image_as_jpeg(file_path, file_name)
    if decoded is None:
        return None
    image_bytes, width, height = decoded

    from knowledge_layer.ingest import processing as _processing

    content_type, caption = _processing._cached_vlm_call(
        image_bytes,
        f"image:charts={extract_charts}",
        _analyze_image_with_vlm,
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        extract_charts=extract_charts,
        model=vlm_model,
    )
    if _processing.is_failed_caption(caption):
        logger.error("VLM captioning failed for standalone image %s: %s", file_name, caption[:120])
        return None

    prefix = "CHART" if content_type == "chart" else "IMAGE"
    return Document(
        text=f"[{prefix} from page 1]\n\n{caption}",
        metadata={
            "file_name": file_name,
            "file_size": file_size,
            "page_label": "1",
            "content_type": content_type,
            "image_index": 0,
            "image_format": image_format,
            "image_width": width,
            "image_height": height,
        },
    )


def analyze_visual(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    vlm_api_key: str | None = None,
    extract_charts: bool = True,
    context: str | None = None,
) -> tuple[str, str, dict[str, Any]]:
    """Analyse ONE visual — the single entry point for every image source.

    ``context`` is a sentence the model is told about the image that the pixels
    do not show (a photo's capture date, read from its EXIF). It is part of the
    cache key: the cache is keyed on pixels, and the same pixels taken on two
    days are two captions.

    A rendered PDF page, a raster embedded in a PDF and an uploaded image file
    all arrive here. They used to be analysed by two different prompts: pages
    got the structured schema while embedded rasters got a generic English
    caption, so a scanned plan placed inside a PDF was indexed as one paragraph
    while the identical sheet as a vector page was indexed per drawing. There
    is now one prompt, and photos and diagrams are types WITHIN it.

    Returns ``(content_type, caption, fields)`` where ``content_type`` is
    ``drawing`` / ``chart`` / ``image``, ``caption`` is the text to index and
    ``fields`` carries the flat legacy fields plus, when the reply parsed, the
    full analysis under ``fields["analysis"]``.

    Degradation is layered, cheapest first: a parsed v3 analysis types itself;
    a v1 ``KEY: value`` reply is a drawing by construction; a reply that parses
    as NEITHER — prose from a model that cannot hold the JSON, or an outright
    provider failure — spends one more call on the legacy caption prompt, which
    both keeps charts classified and gives the big prompt a smaller thing to
    fail back to. Only when that also fails is a failure placeholder returned,
    for the caller to skip rather than index.
    """
    from knowledge_layer.ingest import processing as _processing
    from knowledge_layer.ingest import visual_analysis
    from knowledge_layer.ingest import visual_domains

    context_key = f":ctx={hashlib.sha256(context.encode('utf-8')).hexdigest()[:16]}" if context else ""
    caption, fields = _processing._cached_vlm_call(
        image_bytes,
        visual_analysis.cache_prompt_type(visual_domains.resolve_registry()) + context_key,
        _analyze_drawing_page_with_vlm,
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        model=vlm_model,
        **({"context": context} if context else {}),
    )
    fields = fields if isinstance(fields, dict) else {}

    if not _processing.is_failed_caption(caption):
        analysis = fields.get("analysis")
        if analysis:
            return (visual_analysis.content_type_for(analysis), caption, fields)
        if fields:
            return ("drawing", caption, fields)

    logger.info("Structured visual analysis unusable; falling back to the caption prompt")
    content_type, legacy_caption = _processing._cached_vlm_call(
        image_bytes,
        f"image:charts={extract_charts}",
        _analyze_image_with_vlm,
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        extract_charts=extract_charts,
        model=vlm_model,
    )
    return (content_type, legacy_caption, {})


_VISUAL_PREFIXES = {"drawing": "DRAWING", "chart": "CHART", "image": "IMAGE"}
_VISUAL_MARKER = re.compile(r"^\[(?:DRAWING|CHART|IMAGE) from page \d+\]\s*")


def _strip_visual_marker(text: str) -> str:
    """A visual chunk's body without its ``[IMAGE from page 1]`` marker.

    The marker is for retrieval, which cites a page; a summary built from the
    chunk is shown to people, who saw "[IMAGE from page 1] Foto der Baustelle…"
    as the description of their photo.
    """
    return _VISUAL_MARKER.sub("", text, count=1)


def visual_documents(
    content_type: str,
    caption: str,
    fields: dict[str, Any],
    *,
    file_name: str,
    file_size: int,
    page_number: int,
    extra_metadata: dict[str, Any] | None = None,
) -> list[Any]:
    """Turn one analysed visual into its indexable chunks — the single builder.

    A structured analysis yields ONE chunk PER SEGMENT (a sheet carrying
    Grundriss + Schnitt + Detail becomes three targeted chunks, each with its
    own scale and its own slice of ``drawing_data``); anything else yields the
    single caption chunk. ``extra_metadata`` is what differs between sources —
    the embedded-image indices and formats, a render's pixel size — and nothing
    else about the shape does.
    """
    from knowledge_layer.ingest import visual_analysis
    from llama_index.core import Document

    prefix = _VISUAL_PREFIXES.get(content_type, "IMAGE")
    base = {
        "file_name": file_name,
        "file_size": file_size,
        "page_label": str(page_number),
        "content_type": content_type,
        **(extra_metadata or {}),
    }

    analysis = fields.get("analysis") if fields else None
    if analysis:
        return [
            Document(
                text=f"[{prefix} from page {page_number}]\n\n{payload['text']}",
                metadata={
                    **base,
                    "drawing_type": payload["drawing_type"],
                    "drawing_scale": payload["drawing_scale"],
                    "segment_index": payload["segment_index"],
                    "segment_count": payload["segment_count"],
                    "drawing_data": payload["drawing_data"],
                },
            )
            for payload in visual_analysis.segment_payloads(analysis)
        ]

    metadata = dict(base)
    if fields:
        metadata["drawing_type"] = fields.get("drawing_type", "")
        metadata["drawing_scale"] = fields.get("scale", "")
    return [Document(text=f"[{prefix} from page {page_number}]\n\n{caption}", metadata=metadata)]


def _build_image_documents(
    file_path: str,
    file_name: str,
    file_size: int,
    image_format: str,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    extract_charts: bool = True,
    vlm_api_key: str | None = None,
    photo: Any = None,
) -> list[Any] | None:
    """Standalone uploaded image → Documents, through the shared analyser.

    ``photo`` is the image's :class:`~knowledge_layer.ingest.photo_facts.PhotoFacts`,
    read from the ORIGINAL bytes before the re-encode drops EXIF. Its capture
    date reaches the model and the chunks; its position reaches neither.

    Thin by design: decode, then the same :func:`analyze_visual` +
    :func:`visual_documents` every other source uses. Returns ``None`` when the
    image cannot be decoded or its analysis failed outright — the caption is
    the file's only content, so the caller fails the file (retryable via
    re-ingest) rather than indexing a content-free chunk.
    """
    from knowledge_layer.ingest import processing as _processing

    decoded = _read_image_as_jpeg(file_path, file_name)
    if decoded is None:
        return None
    image_bytes, width, height = decoded

    content_type, caption, fields = analyze_visual(
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        extract_charts=extract_charts,
        context=photo.model_context() if photo is not None else None,
    )
    if _processing.is_failed_caption(caption):
        logger.error("VLM analysis failed for standalone image %s: %s", file_name, caption[:120])
        return None

    captured = {}
    if photo is not None and photo.captured_at:
        captured["captured_at"] = photo.captured_at
    if photo is not None and photo.camera:
        captured["camera"] = photo.camera

    return visual_documents(
        content_type,
        caption,
        fields,
        file_name=file_name,
        file_size=file_size,
        page_number=1,
        extra_metadata={
            "image_index": 0,
            "image_format": image_format,
            "image_width": width,
            "image_height": height,
            **captured,
        },
    )


def _looks_like_raw_pdf_or_binary(text: str) -> bool:
    """Reject raw PDF bytes or binary-looking text before it reaches the vector store."""
    sample = text[:4096]
    if sample.lstrip().startswith("%PDF"):
        return True
    if "endobj" in sample and "xref" in sample:
        return True
    if "\x00" in sample:
        return True
    if not sample:
        return False

    control_count = sum(1 for ch in sample if ord(ch) < 32 and ch not in "\n\r\t")
    return control_count / len(sample) > 0.05


def _table_to_markdown(table: list[list[str]]) -> str:
    """Convert a table (list of lists) to markdown format."""
    if not table or not table[0]:
        return ""

    def clean_cell(cell):
        if cell is None:
            return ""
        return str(cell).replace("|", "\\|").replace("\n", " ").strip()

    lines = []

    header = [clean_cell(cell) for cell in table[0]]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")

    for row in table[1:]:
        cells = [clean_cell(cell) for cell in row]
        while len(cells) < len(header):
            cells.append("")
        lines.append("| " + " | ".join(cells[: len(header)]) + " |")

    return "\n".join(lines)


def _ingest_cost_scope(job_id: str, config: dict[str, Any]):
    """The cost tracker an ingestion job's model calls are recorded under (``activity = ingest``)."""
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


def _analyze_image_with_vlm(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    extract_charts: bool = True,
    vlm_api_key: str | None = None,
) -> tuple[str, str]:
    """
    Analyze an image using NVIDIA's VLM API - classify AND caption in ONE call.

    This is optimized for the no-deployment workflow:
    - Single VLM call instead of separate classify + caption calls
    - Returns both content type and description

    Args:
        image_bytes: Raw image bytes.
        vlm_model: NVIDIA VLM model name.
        extract_charts: If True, use chart-aware prompt that extracts data.
        vlm_api_key: Pre-resolved key (e.g. an org's BYOK key). When ``None`` the
            org-agnostic deployment key is used.

    Returns:
        Tuple of (content_type, caption) where content_type is "chart" or "image".
    """
    try:
        import openai  # noqa: F401 - availability check; the client comes from _vlm_client
    except ImportError:
        logger.warning("openai package not installed. Install with: pip install openai")
        return ("image", "[Image - captioning unavailable]")

    api_key = vlm_api_key if vlm_api_key is not None else _get_vlm_api_key()
    if not api_key:
        return ("image", "[Image - VLM API key not set]")

    if extract_charts:
        prompt = """Analyze this image and respond in the following format:

TYPE: [chart/graph/image]

If this is a chart or graph, extract:
- Chart type (bar, line, pie, scatter, etc.)
- Title and axis labels
- Key data points and values
- Main trends or insights

If this is a regular image (e.g. a plan, map or architectural drawing), describe its CONTENT and meaning:
- Main subject and what the image actually depicts
- Key elements and their spatial / architectural relationships
- Only textual labels that belong to the content (e.g. titles, room names, dimensions)

Do NOT include any licence, watermark or tool-stamp text (e.g. "VECTORWORKS EDUCATIONAL VERSION",
"AutoCAD", "DRAFT") in your description; ignore such overlays entirely and describe only the actual
content and its meaning, not merely what is visible.

Provide a detailed, structured response."""
    else:
        prompt = (
            "Describe this image in detail, focusing on the CONTENT and meaning of what is depicted "
            "(the main subject, its elements, and any spatial or architectural information) rather than "
            "merely listing what is visible. Do NOT include any licence, watermark or tool-stamp text "
            '(e.g. "VECTORWORKS EDUCATIONAL VERSION", "AutoCAD", "DRAFT") in your description; ignore '
            "such overlays entirely."
        )

    try:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        client = _vlm_client(vlm_base_url, api_key)

        caption = _vlm_chat_create(
            client,
            model=vlm_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    ],
                }
            ],
            max_tokens=512,
            prompt_id=f"image:charts={extract_charts}",
        )

        logger.debug(f"VLM analysis: {caption[:100]}...")

        content_type = "image"
        if extract_charts:
            caption_lower = caption.lower()
            if any(
                indicator in caption_lower
                for indicator in [
                    "type: chart",
                    "type: graph",
                    "bar chart",
                    "line chart",
                    "pie chart",
                    "scatter plot",
                    "histogram",
                    "chart type:",
                    "this chart",
                    "this graph",
                    "the chart",
                    "the graph",
                ]
            ):
                content_type = "chart"

        return (content_type, caption)

    except Exception as e:
        logger.error(f"VLM analysis failed: {e}")
        return ("image", f"[Image - analysis failed: {str(e)[:50]}]")


def _caption_image_with_vlm(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    prompt: str = "Describe this image in detail.",
    is_chart: bool = False,
) -> str:
    """Legacy wrapper - use _analyze_image_with_vlm for new code."""
    _, caption = _analyze_image_with_vlm(
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        extract_charts=is_chart,
    )
    return caption


def _parse_drawing_fields(caption: str) -> dict[str, str]:
    """Parse the v1 ``KEY: value`` lines of a drawing-VLM response into a dict.

    Lenient: unknown/extra lines are ignored and any field the model omitted is
    simply absent. Keys are normalised to lowercase ascii slugs.
    """
    field_map = {
        "zeichnungstyp": "drawing_type",
        "massstab": "scale",
        "maßstab": "scale",
        "titel/projekt": "title",
        "geschosse/ebenen": "levels",
        "nutzung": "use",
        "räume/elemente": "elements",
        "materialien/bauweise": "materials",
        "abmessungen/koten": "dimensions",
        "räumliche beziehungen": "spatial_relations",
        "detailbeschreibung": "detail",
        "wasserzeichen": "watermark",
        "zusammenfassung": "summary",
    }
    out: dict[str, str] = {}
    for line in (caption or "").splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        slug = field_map.get(key.strip().lower())
        if slug and value.strip():
            out[slug] = value.strip()
    return out


DRAWING_ANALYSIS_MAX_TOKENS = 6000


def _analyze_drawing_page_with_vlm(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    vlm_api_key: str | None = None,
    context: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """VLM-analyse a full rendered PDF page as a technical drawing (schema v2).

    Returns ``(caption, fields)``. ``caption`` is the rendered structured text
    (``visual_analysis.render_analysis_text``) stored/embedded in the chunk;
    ``fields`` is the flat dict every pre-schema consumer reads (drawing_type,
    scale, summary, …) plus — when the reply parsed — the full canonical
    analysis under ``fields["analysis"]``. A reply that is not valid schema
    JSON falls back verbatim to the legacy ``KEY: value`` path, so a weaker
    model degrades rather than fails. The domain vocabulary comes from the
    resolved :mod:`visual_domains` registry, so this function is the same for
    architecture and for any other domain. ``vlm_api_key`` is a pre-resolved
    key (e.g. an org's BYOK key); ``None`` uses the org-agnostic deployment
    key. Fail-open: on any error returns a placeholder caption and empty
    fields so the page is still indexed (never crashes the job).
    """
    from knowledge_layer.ingest import visual_analysis
    from knowledge_layer.ingest import visual_domains

    registry = visual_domains.resolve_registry()

    try:
        import openai  # noqa: F401 - availability check; the client comes from _vlm_client
    except ImportError:
        logger.warning("openai package not installed. Install with: pip install openai")
        return ("[Drawing - captioning unavailable]", {})

    api_key = vlm_api_key if vlm_api_key is not None else _get_vlm_api_key()
    if not api_key:
        return ("[Drawing - VLM API key not set]", {})

    try:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        client = _vlm_client(vlm_base_url, api_key)
        reply = _vlm_chat_create(
            client,
            model=vlm_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": visual_analysis.build_prompt(registry, context=context)},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    ],
                }
            ],
            max_tokens=DRAWING_ANALYSIS_MAX_TOKENS,
            prompt_id=visual_analysis.cache_prompt_type(registry),
        ).strip()
        if not reply:
            return ("[Drawing - empty VLM response]", {})
        logger.debug("Drawing VLM analysis: %s...", reply[:100])
        analysis = visual_analysis.parse_visual_analysis(reply, registry)
        if analysis is None:
            return (reply, _parse_drawing_fields(reply))
        fields: dict[str, Any] = visual_analysis.legacy_fields(analysis)
        fields["analysis"] = analysis
        return (visual_analysis.render_analysis_text(analysis), fields)
    except Exception as e:
        logger.error("Drawing VLM analysis failed: %s", e)
        return (f"[Drawing - analysis failed: {str(e)[:50]}]", {})


def _summary_from_drawing_fields(pages: list[dict[str, Any]]) -> str | None:
    """Build a document summary from rendered-page drawing descriptions.

    Prefers the per-page ``ZUSAMMENFASSUNG`` sentences; falls back to a
    ``drawing_type @ scale`` synthesis so a document that is entirely drawings
    still gets a meaningful, watermark-free summary. Returns ``None`` when no
    usable fields were extracted (caller then keeps its text-based fallback).
    """
    sentences = [p["fields"].get("summary", "").strip() for p in pages if p.get("fields")]
    sentences = [s for s in sentences if s]
    if sentences:
        summary = " ".join(sentences[:3])
        return summary[:600].rstrip()

    synth: list[str] = []
    for p in pages:
        fields = p.get("fields") or {}
        dtype = fields.get("drawing_type")
        if not dtype:
            continue
        scale = fields.get("scale")
        synth.append(f"{dtype} (Maßstab {scale})" if scale and scale.lower() != "unbekannt" else dtype)
    if synth:
        return ("Technische Zeichnungen: " + "; ".join(synth[:5]))[:600].rstrip()
    return None


def _future_result(future, what: str, file_name: str, timeout: float = 30):
    """A background ingestion step's result, or ``None`` when it was not started, timed out or failed."""
    if future is None:
        return None
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        logger.warning("%s timed out for %s", what, file_name)
    except Exception as e:  # noqa: BLE001 — an annotation is worth less than the ingestion
        logger.warning("%s failed for %s: %s", what, file_name, e)
    return None


def _digest_passages(documents: list[Any]) -> list[tuple[Any, str, str]]:
    """``(page, content type, text)`` per document chunk, in reading order: what the dossier digest reads."""
    return [
        (doc.metadata.get("page_label"), str(doc.metadata.get("content_type") or "text"), doc.get_content())
        for doc in documents
    ]


def _page_number(label: Any) -> int | None:
    try:
        number = int(str(label).strip())
    except TypeError, ValueError:
        return None
    return number if number > 0 else None


def _reading_of(
    documents: list[Any], dossier: dict[str, Any] | None, predecessor: tuple[str, Any] | None = None
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """The dossier with the facts the drawings printed, and the document's references. Pure over the chunks.

    A drawing's analysis already holds its printed quantities (``drawing_data``); the ones
    that are project facts join the dossier's own, once per key and value. References are
    read from every chunk's text, a drawing's annotations included, and a document's
    references to its own kind are dropped.
    """
    from knowledge_layer.references import extract_references

    from agent.knowledge.dossier import MAX_FACTS
    from agent.knowledge.dossier import lifted_drawing_facts
    from agent.knowledge.dossier import own_document_type

    references = extract_references(
        ((doc.get_content(), _page_number(doc.metadata.get("page_label"))) for doc in documents),
        own_document_type=own_document_type(dossier),
    )
    if not dossier:
        return None, references
    analyses = []
    for doc in documents:
        raw = doc.metadata.get("drawing_data")
        if not raw:
            continue
        try:
            analyses.append(
                (_page_number(doc.metadata.get("page_label")), json.loads(raw) if isinstance(raw, str) else raw)
            )
        except TypeError, ValueError:
            continue
    facts = list(dossier.get("facts") or [])
    seen = {(fact["key"], fact["value"]) for fact in facts}
    for fact in lifted_drawing_facts(analyses):
        if (fact["key"], fact["value"]) not in seen and len(facts) < MAX_FACTS:
            seen.add((fact["key"], fact["value"]))
            facts.append(fact)
    reading = {**dossier, "facts": facts}
    if predecessor is not None:
        from agent.knowledge.dossier import fact_changes

        name, before = predecessor
        changes = fact_changes(before if isinstance(before, dict) else None, reading)
        if changes:
            reading["changes"] = changes
            reading["changed_against"] = name
    return reading, references


def _predecessor_dossier(
    rows: Sequence[Any], stored_names: Sequence[str], confirmed_older: str | None
) -> tuple[str, Any] | None:
    """The Fassung this file replaces and its dossier, from the rows read before this upload overwrote them."""
    wanted = [*stored_names, *([confirmed_older] if confirmed_older else [])]
    for name in wanted:
        row = next((row for row in rows if getattr(row, "file_name", None) == name), None)
        if row is not None and getattr(row, "dossier", None):
            return name, row.dossier
    return None


def _generate_document_summary(text_content: str, file_name: str, llm=None) -> str | None:
    """
    Generate one-sentence summary from document text.

    Thin wrapper over the shared, backend-agnostic
    ``summarize_document_text`` (prompt + call + parse live in one place so the
    two backends can never drift). LlamaIndex supplies the text from already
    extracted chunks.

    Args:
        text_content: Combined first + last chunk text.
        file_name: Filename for context.
        llm: LangChain LLM object. Required - no default fallback.

    Returns:
        One-sentence summary or None if no LLM provided or generation failed.
    """
    from agent.knowledge.document_classification import summarize_document_text

    return summarize_document_text(text_content, file_name, llm)


_TMP_UPLOAD_PREFIX = re.compile(r"^tmp.{8}_")


def _rendition_companions(original_path: str, file_name: str, file_size: int) -> list[Any]:
    """The original's units a PDF rendition lacks (pptx speaker notes), fail-open.

    The rendition already indexed the document's text and pictures; notes that
    cannot be read cost the notes, not the file (visual-ingestion rule 4).
    """
    from knowledge_layer.ingest import office_extractors

    try:
        return office_extractors.extract_rendition_companions(original_path, file_name, file_size)
    except Exception as error:  # noqa: BLE001 — per-unit fail-open, named in the log
        logger.warning("Speaker notes of %s skipped: %s", file_name, type(error).__name__)
        return []


def _normalized_file_name(name: str | None) -> str:
    """A stored file name as its plain re-upload spells it: no ``tmp[8]_`` prefix, percent-decoded."""
    from urllib.parse import unquote

    return unquote(_TMP_UPLOAD_PREFIX.sub("", name or ""))


def _stored_name_matches(requested: str, stored: str) -> bool:
    """Whether a chunk stored under ``stored`` belongs to the file a delete names ``requested``.

    The stored ``file_name`` can diverge from the requested name in two ways:
    a temp-upload prefix (Python's tempfile: ``tmp[8 chars]_filename``), and
    percent-encoding, when the name was derived from a presigned-URL path at
    ingest time (a space or umlaut stored as ``%20``/``%C3%…``). Decoding the
    stored side lets a document ingested under an encoded name still be
    deleted by its real, decoded filename. One rule for every reader of the
    stored names (``delete_file``, ``QdrantStore.delete_file``).
    """
    from urllib.parse import unquote

    stripped = _TMP_UPLOAD_PREFIX.sub("", stored or "")
    return requested in (stripped, unquote(stripped))


def _stored_spellings(name: str) -> set[str]:
    """The ``file_name`` values a stored version of ``name`` can carry, short of a tmp prefix.

    The plain name, and the percent-encoded forms a presigned-URL path produced
    before ``/v1/ingest`` decoded it: Python's ``quote`` (the S3 presigner's
    encoding) and the lighter one ``encodeURIComponent`` writes. The random
    ``tmp[8]_`` prefix cannot be enumerated; the metadata rows supply it
    (:func:`agent.knowledge.find_tmp_upload_names`).
    """
    from urllib.parse import quote

    plain = _normalized_file_name(name)
    return {name, plain, quote(plain), quote(plain, safe="!'()*~")}


def _replacement_lock_key(collection_name: str, file_name: str) -> str:
    """The keyed lock one document's replacement holds: its collection and normalized name."""
    return f"reingest:{collection_name}:{_normalized_file_name(file_name)}"


@dataclass
class _PreviousVersion:
    """An earlier upload of one normalized file name, collected before a re-ingest."""

    chunk_ids: list[str] = field(default_factory=list)
    stored_names: list[str] = field(default_factory=list)
    preserved: dict[str, str] = field(default_factory=dict)


def _tmp_upload_names(collection_name: str, spellings: list[str]) -> list[str]:
    """The legacy ``tmp…_`` names the metadata rows know for ``spellings``; none when that store fails (logged)."""
    from agent.knowledge import find_tmp_upload_names

    try:
        return list(find_tmp_upload_names(collection_name, spellings))
    except Exception:  # noqa: BLE001 — it only adds legacy spellings; their version stays beside the re-upload
        logger.warning(
            "Could not read the tmp-prefixed names in %s; a legacy version may stay beside its re-upload",
            collection_name,
            exc_info=True,
        )
        return []


def _read_human_set_fields(collection_name: str, found: dict[str, _PreviousVersion]) -> None:
    """Copy what people set on each previous version's row onto its entry. Fail-open.

    ``tags`` is carried only when a person chose them, as their JSON text: the
    classifier's own tags are re-derived from the new bytes, as they should be.
    ``superseded_by`` is always a person's confirmation, and ``revision_suggestion``
    keeps a dismissal a person made.
    """
    try:
        from agent.knowledge import get_document_display_titles
        from agent.knowledge import get_document_doc_classes
        from agent.knowledge import get_document_folder_paths
        from agent.knowledge import get_document_person_tags
        from agent.knowledge import get_document_person_topics
        from agent.knowledge import get_document_revision_suggestions
        from agent.knowledge import get_document_superseded_by

        stored_names = [stored for version in found.values() for stored in version.stored_names]
        person_tags = {
            stored: json.dumps(tags) for stored, tags in get_document_person_tags(collection_name, stored_names).items()
        }
        person_topics = {
            stored: json.dumps(topics)
            for stored, topics in get_document_person_topics(collection_name, stored_names).items()
        }
        for name, values in (
            ("doc_class", get_document_doc_classes(collection_name, stored_names)),
            ("display_title", get_document_display_titles(collection_name, stored_names)),
            ("folder_path", get_document_folder_paths(collection_name, stored_names)),
            ("tags", person_tags),
            ("topics", person_topics),
            ("superseded_by", get_document_superseded_by(collection_name, stored_names)),
            ("revision_suggestion", get_document_revision_suggestions(collection_name, stored_names)),
        ):
            for stored, value in values.items():
                version = found.get(_normalized_file_name(stored))
                if version is not None:
                    version.preserved.setdefault(name, value)
    except Exception:  # noqa: BLE001 — losing them must not keep the old chunks
        logger.warning("Could not read the previous versions' metadata; re-deriving it", exc_info=True)


def _file_info_from_job(job: IngestionJobStatus, detail: FileProgress) -> FileInfo:
    """A job's account of one of its files, as the listing states it.

    The id is derived from the collection and the name, not read from the
    detail: a row written before ids were derived carries a random one, and the
    listing, a lookup and a delete must agree whichever process wrote the row.
    A file the job never finished when the job itself failed is FAILED, with the
    job's reason: nothing will finish it.
    """
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
    """One file from its two records: the chunks the store holds, and the newest job's account of it.

    The chunks say what is indexed; the job says what is happening to the file
    or why it failed. A re-upload that failed leaves the version it replaced
    indexed, and is FAILED all the same. A job alone lists a file only until it
    finishes: a finished one with no chunks was deleted, or never indexed.
    """
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


_LISTING_PAGE = 2048


class _PdfScreen(NamedTuple):
    """A PDF the upload screen let through: its routing and how much of it was screened.

    ``triage`` is the page triage ``route_pdf_pages`` runs on, measured once here
    (``None`` when the PDF could not be measured). ``checked`` is ``partial`` when
    some content reaches a model unscreened. ``routing()`` is what ``route_pdf_pages``
    takes: no ``triage`` key when there is none, so it measures the PDF itself,
    exactly as the old empty dict did.
    """

    triage: Any = None
    checked: str = "full"

    def routing(self) -> dict[str, Any]:
        return {} if self.triage is None else {"triage": self.triage}


_INGEST_PERF_ORDER = (
    "text",
    "tables",
    "screen",
    "ocr",
    "renders",
    "rasters",
    "vision",
    "summary",
    "dossier",
    "embedding",
    "write",
)


@contextlib.contextmanager
def _stage(stages: dict[str, float], name: str) -> Iterator[None]:
    """Add one ingestion stage's elapsed seconds to ``stages``.

    Log-only, and never raises: wrap a call site (``with _stage(stages, "text"):``)
    so the per-file ``[ingest-perf]`` line can show where a job's wall time went.
    Accumulates, so a stage reached on more than one path (the screen, run twice)
    is one number.
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        stages[name] = stages.get(name, 0.0) + (time.perf_counter() - start)


def _log_ingest_perf(file_name: str, stages: dict[str, float]) -> None:
    """One ``[ingest-perf]`` line per file: each stage's seconds, in ``_INGEST_PERF_ORDER``.

    The stages a file never reached are simply absent, so a held or failed file
    shows how far it got. Same file name in the line as the other per-file logs.
    """
    parts = [f"{name}={stages[name]:.3f}" for name in _INGEST_PERF_ORDER if name in stages]
    if parts:
        logger.info("[ingest-perf] %s %s", file_name, " ".join(parts))


@register_ingestor("llamaindex")
class LlamaIndexIngestor(TTLCleanupMixin, BaseIngestor):
    """
    LlamaIndex-based document ingestor with optional multimodal extraction.

    Chunks with LlamaIndex, embeds through an OpenAI-compatible endpoint and
    writes every chunk to Qdrant (``knowledge_layer.vector_store``, ADR-0115).

    Configuration options:
        embed_model: Embedding model name (default: openai/text-embedding-3-large)
        embed_base_url: Embedding model base URL (default: https://openrouter.ai/api/v1)
        chunk_size: Text chunk size (default: 1024, model supports up to 2048 tokens)
        chunk_overlap: Chunk overlap (default: 128)

    Multimodal options:
        extract_tables: Enable table extraction from PDFs (default: True)
        extract_charts: Enable chart extraction with structured data (default: True)
        extract_images: Enable image extraction with VLM captioning (default: True)
        vlm_model: VLM for captioning (default: openai/gpt-6-luna)

    Environment variables:
        QDRANT_URL: The Qdrant cluster every chunk is written to
        EMBED_MODEL: Default embedding model name
        EMBED_BASE_URL: Default embedding model base URL
        EXTRACT_TABLES: Set "false" to disable table extraction (on by default)
        EXTRACT_CHARTS: Set "false" to disable chart typing (on by default)
        EXTRACT_IMAGES: Set "false" to disable image extraction (on by default)
        VLM_MODEL: VLM model for captioning
        VLM_BASE_URL: Default VLM base URL
        COLLECTION_TTL_HOURS: Hours before stale collections are deleted (default: 24)
        TTL_CLEANUP_INTERVAL_SECONDS: Seconds between cleanup runs (default: 3600)
    """

    DEFAULT_EMBED_MODEL = os.environ.get("EMBED_MODEL", "openai/text-embedding-3-large")

    DEFAULT_EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "https://openrouter.ai/api/v1")

    DEFAULT_EXTRACT_TABLES = env_switch("EXTRACT_TABLES")

    INGEST_MAX_WORKERS = max(1, env_int("INGEST_MAX_WORKERS", 2))

    DEFAULT_EXTRACT_IMAGES = env_switch("EXTRACT_IMAGES")

    DEFAULT_EXTRACT_CHARTS = env_switch("EXTRACT_CHARTS")

    backend_name = "llamaindex"
    supports_durable_jobs = True

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__(config)

        self.embed_base_url = self.config.get("embed_base_url", self.DEFAULT_EMBED_BASE_URL)
        self.embed_model_name = self.config.get("embed_model", self.DEFAULT_EMBED_MODEL)
        self.chunk_size = self.config.get("chunk_size", 1024)
        self.chunk_overlap = self.config.get("chunk_overlap", 128)

        self.extract_tables = self.config.get("extract_tables", self.DEFAULT_EXTRACT_TABLES)
        self.extract_images = self.config.get("extract_images", self.DEFAULT_EXTRACT_IMAGES)
        self.extract_charts = self.config.get("extract_charts", self.DEFAULT_EXTRACT_CHARTS)
        self.vlm_model = self.config.get("vlm_model", DEFAULT_VLM_MODEL)
        self.vlm_base_url = self.config.get("vlm_base_url", DEFAULT_VLM_BASE_URL)

        self.generate_summary_enabled = self.config.get("generate_summary", False)
        self.summary_llm = self.config.get("summary_llm")  # Resolved LangChain LLM (or None)

        self._jobs: dict[str, IngestionJobStatus] = {}
        self._lock = threading.RLock()  # RLock allows same thread to acquire multiple times
        self._persist_lock = threading.Lock()
        self._unpersisted: set[str] = set()
        self._unstored_at_prepare: set[str] = set()
        self._claim_guards: dict[str, Callable[[], bool]] = {}

        self._ingest_pool = ThreadPoolExecutor(self.INGEST_MAX_WORKERS, thread_name_prefix="llamaindex-ingest")

        self._embed_model = None
        self._initialized = False

        mode_parts = ["text"]
        if self.extract_tables:
            mode_parts.append("tables")
        if self.extract_charts:
            mode_parts.append("charts")
        if self.extract_images:
            mode_parts.append("images")
        mode = " + ".join(mode_parts) if len(mode_parts) > 1 else "text-only"

        logger.info(f"LlamaIndexIngestor initialized: mode={mode}")

        self._start_ttl_cleanup_task(COLLECTION_TTL_HOURS, TTL_CLEANUP_INTERVAL_SECONDS)
        self._start_ingest_heartbeat()

    def _start_ingest_heartbeat(self) -> None:
        """Vouch for this process's live jobs in the shared status store, on a daemon thread.

        The pool is in-process, so a restart ends every job in it silently; the
        heartbeat is what lets any replica tell such a job from a slow one
        (``ingest_status_store``). The thread first settles what an earlier
        process left stranded, off the constructor's path because it is DB I/O.
        """
        threading.Thread(target=self._heartbeat_loop, daemon=True, name="llamaindex-ingest-heartbeat").start()

    def _heartbeat_loop(self) -> None:
        self._settle_stranded_jobs()
        ingest_status_store.prune_expired(FILE_TRACKING_RETENTION_SECONDS)
        for beats in itertools.count(1):
            time.sleep(ingest_status_store.HEARTBEAT_INTERVAL_SECONDS)
            self._beat()
            if beats % _PRUNE_EVERY_BEATS == 0:
                ingest_status_store.prune_expired(FILE_TRACKING_RETENTION_SECONDS)

    @staticmethod
    def _settle_stranded_jobs() -> None:
        settled = ingest_status_store.fail_interrupted()
        if settled:
            logger.warning("Settled %d ingest job(s) a previous process left unfinished as interrupted", settled)

    def _beat(self) -> None:
        """Vouch for the live jobs, re-write any whose row is not ours, retry the writes that failed."""
        live = self._live_job_ids()
        refreshed = ingest_status_store.heartbeat(live)
        if refreshed is not None and refreshed < len(live):
            logger.warning("Heartbeat refreshed %d of %d live ingest job(s); re-writing them", refreshed, len(live))
            with self._persist_lock:
                self._unpersisted.update(live)
        self._retry_unpersisted()

    def _persist(self, job: IngestionJobStatus) -> None:
        """Write ``job`` to the shared status store; a write that fails is retried on the heartbeat.

        A terminal status that never lands is the costly loss: heartbeats cover
        only live jobs, so the row stays ``processing``, ages, and another
        replica settles it ``failed: interrupted`` while the chunks are indexed.
        Writes are serialized and each stores the job as it is when the write
        starts, so a retry can never put an older status over a newer one.
        Lock order: ``_persist_lock`` then ``_lock``, so never call this while
        holding ``_lock``. ``_persist_lock`` also guards ``_unpersisted``.

        A run that was told to stop writes no live or failed status again
        (``_told_to_stop``): whoever stopped it settled the row, and this write,
        or the heartbeat's re-write of a row it no longer owns, would turn a
        person's ``cancelled`` back into ``processing``. The skip counts as
        stored, so the heartbeat does not try it again. ``completed`` is still
        written: past the last ownership check the chunks are indexed, and the
        row must say so (the BFF heals a stopped document from it).
        """
        with self._persist_lock:
            with self._lock:
                snapshot = job.model_copy(deep=True)
            stopped = snapshot.status != JobState.COMPLETED and self._told_to_stop(job.job_id)
            if stopped or ingest_status_store.put(snapshot):
                self._unpersisted.discard(job.job_id)
            else:
                self._unpersisted.add(job.job_id)

    def _retry_unpersisted(self) -> None:
        """Write again every job whose last write failed, for as long as this process tracks it.

        Bounded by the job registry's retention: a terminal job is pruned
        ``JOB_RETENTION_SECONDS`` after it finished, together with its row, and
        a job no longer tracked is dropped from the retry set.
        """
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
            return [jid for jid, job in self._jobs.items() if job.status in (JobState.PENDING, JobState.PROCESSING)]

    def find_live_job(self, dispatch_key: str) -> str | None:
        """This replica's live job for ``dispatch_key``, else any replica's (see ``BaseIngestor``)."""
        if not dispatch_key:
            return None
        with self._lock:
            for jid, job in self._jobs.items():
                live = job.status in (JobState.PENDING, JobState.PROCESSING)
                if live and job.metadata.get("dispatch_key") == dispatch_key:
                    return jid
        shared = ingest_status_store.find_live(dispatch_key)
        return shared.job_id if shared is not None else None

    def _ensure_initialized(self):
        """Lazy initialization of LlamaIndex components."""
        if self._initialized:
            return

        dependencies.ensure_retrieval_dependencies()

        try:
            embed_api_key = embedding.resolve_embed_api_key(self.embed_base_url, self.embed_model_name)
            if not embed_api_key:
                logger.error(
                    "No embeddings API key resolved (EMBED_API_KEY / "
                    "the provider key for EMBED_BASE_URL) - ingestion/retrieval will fail."
                )

            self._embed_model = embedding.make_embed_model(
                base_url=self.embed_base_url,
                model=self.embed_model_name,
                api_key=embed_api_key,
                embed_batch_size=EMBED_BATCH_SIZE,
                timeout=EMBED_TIMEOUT_SECONDS,
                max_retries=EMBED_MAX_RETRIES,
            )

            self._initialized = True
            logger.info(f"LlamaIndex components initialized with model: {self.embed_model_name}")

        except ImportError as e:
            raise retrieval_dependency_error(e) from e

    @staticmethod
    def _store():
        """The process-wide Qdrant store. Reads and deletes need no embedder; a write names it (``_ingest_job``)."""
        from knowledge_layer.vector_store import get_store

        return get_store()

    def _chunk_ids_of(self, collection_name: str, stored_names: list[str]) -> list[tuple[str, str]]:
        """``(chunk_id, stored file_name)`` of every chunk stored under one of ``stored_names``."""
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

    def _record_file_counts(self, job: IngestionJobStatus, file_index: int, **counts: int) -> None:
        """Put extraction counts on a file's job status, where a later
        "partially indexed" signal reads them (``images_over_cap``,
        ``images_over_pixel_budget`` today)."""
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
        """Record a file's outcome on the job, then in the shared store.

        The job's ``file_details`` is the file's record: ``list_files`` and
        ``get_file_status`` in any process read it from the store, so a FAILED
        file's reason is written there with the status, not kept here.

        A FAILED file also gets its failure category and whether the same bytes
        may read on a retry (``ingest_failures.classify_failure``), from the
        reason and, when the per-file catch had one, the exception ``exc``. One
        place for every failure the adapter writes, so no call site can fail a
        file without saying whether retrying it is worth anything.
        """
        from agent.knowledge.ingest_failures import classify_failure

        with self._lock:
            if file_index < len(job.file_details):
                file_detail = job.file_details[file_index]
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

            job.processed_files = file_index + 1

        self._persist(job)

    def _record_screening(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        outcome: str,
        quarantine: QuarantineVerdict | None = None,
    ) -> None:
        """Put the upload screen's outcome on the file's status; nothing when the job is not screened.

        ``quarantine`` is the typed verdict a ``quarantined`` outcome carries
        (ADR-0113); every other outcome clears it, so a file read again never
        keeps an earlier run's reasons.
        """
        if rules is None:
            return
        with self._lock:
            if file_index < len(job.file_details):
                job.file_details[file_index].screening = outcome
                job.file_details[file_index].quarantine = quarantine if outcome == "quarantined" else None

    def _record_unscreened_rasters(self, job: IngestionJobStatus, file_index: int) -> None:
        """A file the screen called ``clean`` is ``partial`` once embedded rasters go to the VLM.

        The screen decides before any model call from pdfplumber's raster count;
        this is the backstop for rasters it could not see (a page with no text
        has no entry to count them on), so the reported outcome never claims
        more than was screened.
        """
        with self._lock:
            if file_index < len(job.file_details) and job.file_details[file_index].screening == "clean":
                job.file_details[file_index].screening = "partial"

    def _screen_or_quarantine(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        pages: list[tuple[int | None, str]],
        checked: str,
        stream: list[tuple[int, str]] | None = None,
        *,
        after_transcription: bool = False,
    ) -> bool:
        """Screen one file's locally extracted ``pages``; True when it was quarantined.

        ``stream`` is a PDF's text layer page by page, so a match split across a
        page break is found too (``screening.screen_pages``).

        A quarantined file is FAILED with its typed verdict on
        ``FileProgress.quarantine`` (set before the status is persisted) and the
        same verdict as the legacy ``quarantine_error`` text, and must go no
        further: nothing of it has reached a model yet, and nothing will. The
        one exception is ``after_transcription``: the pages screened are the
        vision model's transcript of scanned pages, so that model has seen them,
        and the verdict says so; nothing else of the file reaches a model.
        The log line names reason kinds and counts, never a term, a value or
        the file name, which can itself say what the document is.
        """
        from knowledge_layer.ingest import screening

        if rules is None:
            return False
        if not any(text.strip() for _page, text in pages):
            self._record_screening(job, file_index, rules, "unchecked")
            return False
        verdict = screening.screen_pages(pages, rules, checked=checked, stream=stream or ())
        if after_transcription:
            verdict = dataclasses.replace(verdict, after_transcription=True)
        if not verdict.matched:
            self._record_screening(job, file_index, rules, "clean" if checked == "full" else "partial")
            return False
        self._record_screening(job, file_index, rules, "quarantined", verdict.to_model())
        self._update_file_status(job, file_index, FileStatus.FAILED, error=screening.quarantine_error(verdict))
        logger.info(
            "Quarantined file %d of job %s %s: %s (checked %s)",
            file_index + 1,
            job.job_id,
            "after transcription" if after_transcription else "before any model call",
            screening.log_summary(verdict),
            verdict.checked,
        )
        return True

    def _screen_transcribed(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        text_pages: list[dict[str, Any]],
        *,
        transcribed: bool,
    ) -> bool:
        """Screen a PDF's pages once ``route_pdf_pages`` changed them; True when it was quarantined.

        The whole document again, so a number split between a changed page and
        a text-layer page is found too; the text-layer pages were clean, so a
        match is in or across what changed: a transcript, or the text salvaged
        from a garbled page once its glyph ids were stripped. ``transcribed``:
        the vision model read scanned pages before this check could, and the
        verdict says so (``after_transcription``). Always ``partial``.
        """
        body = [(page["page_number"], page.get("text") or "") for page in text_pages]
        return self._screen_or_quarantine(
            job, file_index, rules, list(body), "partial", stream=body, after_transcription=transcribed
        )

    def _screen_pdf(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        source_path: str,
        text_pages: list[dict[str, Any]],
        companions: list[Any],
        *,
        captions_rasters: bool,
    ) -> _PdfScreen | None:
        """Screen a PDF's text layer and its rendition's companions before any page reaches a model.

        The text layer is screened FIRST, before the table pass: a file the
        screen holds never pays for its tables. The table pass's own Documents
        are screened straight after it reads them (``_screen_tables``), still
        before any model call, so a page the text pass lost can carry a match in
        its table alone.

        Returns the routing and the ``checked`` verdict for ``route_pdf_pages``,
        the page triage measured here so the PDF is measured once, or ``None``
        when the file was quarantined. ``checked`` is ``partial`` when the triage
        sends a page to transcription or drawing analysis, or cannot measure the
        PDF, or when ``captions_rasters`` (the VLM will caption embedded images)
        and a page carries one: that content reaches a model without having been
        screened, which the product accepts for content that cannot be read
        locally. A page the text pass could not read (``failed_pages``) makes it
        ``partial`` too: its text was never read, so never screened.
        """
        if rules is None:
            return _PdfScreen()
        from knowledge_layer.ingest import parsed_store
        from knowledge_layer.ingest.screening import document_pages

        page_texts = page_texts_for_visual_heuristic(text_pages)
        triage = parsed_store.current().triage(
            source_path, page_texts, min_text_chars=VISUAL_PAGE_MIN_TEXT_CHARS, min_paths=VISUAL_PAGE_MIN_PATHS
        )
        has_rasters = any(page.get("image_count") for page in text_pages)
        lost_pages = bool(getattr(text_pages, "failed_pages", ()))
        unscreened = (
            triage is None
            or bool(triage.transcribed or triage.drawings)
            or (captions_rasters and has_rasters)
            or lost_pages
        )
        body = sorted(page_texts.items())
        checked = "partial" if unscreened else "full"
        pages = [*body, *document_pages(companions)]
        if self._screen_or_quarantine(job, file_index, rules, pages, checked, stream=body):
            return None
        return _PdfScreen(triage, checked)

    def _screen_tables(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        table_documents: list[Any],
        checked: str,
    ) -> bool:
        """Screen the table pass's Documents; True when the file was quarantined.

        The table pass runs only after ``_screen_pdf`` passed the text layer, so
        a file about to be held never paid for it. The tables are still screened
        before any model call reads them: a page the text pass lost is read by
        the table pass alone, and a term only its table carries must hold the
        file. Additive to the text screen's verdict, so the rules see the same
        text they saw before the two were split.
        """
        if rules is None:
            return False
        from knowledge_layer.ingest.screening import document_pages

        pages = document_pages(table_documents)
        if not any(text.strip() for _page, text in pages):
            return False
        return self._screen_or_quarantine(job, file_index, rules, pages, checked)

    def _record_failed_pages(self, job: IngestionJobStatus, file_index: int, text_pages: list) -> None:
        """Put the pages a PDF read lost, below the failure threshold, on the file's result."""
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
        """Submit an ingestion job (non-blocking) to this process's pool.

        An entry is a local path, or a deferred download the job runs when it
        reaches the file (``knowledge_layer.ingest.deferred_files``); the latter is
        kept here unchecked, since there is nothing on disk yet to check.
        """
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
        """Validate a job and record it PENDING in the shared store, without running it.

        ``job_id`` is the id the caller chose for this work (the base corpus derives
        one from the file's name, hash and chunk-format version, so asking twice is
        asking once); a fresh uuid otherwise. Re-using an id overwrites that job's
        status, so a caller that chooses ids looks the status up first.

        What runs it is the caller's choice: ``submit_prepared`` queues it in
        this process, and Hatchet (``agent.knowledge.ingest_workflow``) runs it
        on whichever ingest worker is free, on any replica. So a pending
        job is NOT registered in this process here: the process that runs it
        is the one that vouches for it (``_beat``). A job that fails validation
        is final at once, and is registered and stored as failed.
        """
        from knowledge_layer.ingest.deferred_files import is_deferred

        job_id = job_id or str(uuid.uuid4())
        job_config = dict(config or {})

        original_filenames = job_config.get("original_filenames", [])
        validated_paths = []
        aligned_filenames = []
        kept_indices: list[int] = []
        for idx, path in enumerate(file_paths):
            if is_deferred(path) or os.path.exists(path):
                validated_paths.append(path)
                kept_indices.append(idx)
                if idx < len(original_filenames):
                    aligned_filenames.append(original_filenames[idx])
            else:
                logger.warning(f"File not found, skipping: {path}")
        original_filenames = aligned_filenames
        job_config["original_filenames"] = aligned_filenames
        from knowledge_layer.ingest.renditions import align_extraction_paths

        align_extraction_paths(job_config, kept_indices)

        if not validated_paths:
            job = IngestionJobStatus(
                job_id=job_id,
                status=JobState.FAILED,
                submitted_at=datetime.utcnow(),
                total_files=len(file_paths),
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

        job = IngestionJobStatus(
            job_id=job_id,
            status=JobState.PENDING,
            submitted_at=datetime.utcnow(),
            total_files=len(validated_paths),
            processed_files=0,
            collection_name=collection_name,
            backend=self.backend_name,
            file_details=file_details,
            metadata={
                key: job_config[key] for key in ("dispatch_key", "document_id") if isinstance(job_config.get(key), str)
            },
        )

        if not ingest_status_store.put(job):
            with self._persist_lock:
                self._unstored_at_prepare.add(job_id)
        return PreparedIngestJob(job_id, job, validated_paths, collection_name, job_config)

    def _adopt(self, prepared: PreparedIngestJob) -> None:
        """Register a prepared job as this process's: the status it runs and vouches for."""
        with self._persist_lock:
            if prepared.job_id in self._unstored_at_prepare:
                self._unstored_at_prepare.discard(prepared.job_id)
                self._unpersisted.add(prepared.job_id)
        with self._lock:
            self._jobs[prepared.job_id] = prepared.status

    def submit_prepared(self, prepared: PreparedIngestJob) -> None:
        """Queue a prepared job in this process's pool; it stays PENDING while it waits."""
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
        """Run a prepared job here and now, on the calling thread: a job Hatchet handed this worker.

        Adopting it makes this process the one that vouches for it; the first
        status write (`_run_ingestion`'s PROCESSING) takes the row over from
        the process that prepared it. ``still_owner`` answers whether the run
        should go on (it was not cancelled); it is asked before each file is
        read and again before its chunks are written, and a "no" ends the run
        without another write (``_ClaimLost``): a later attempt, if any,
        indexes the file, once.
        """
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
        """Whether the job's run was cancelled; a job this process's own pool runs has no guard and never is."""
        guard = self._claim_guards.get(job_id)
        return guard is not None and not guard()

    def _assert_still_owner(self, job_id: str) -> None:
        """Raise ``_ClaimLost`` when the job's run was stopped."""
        if self._told_to_stop(job_id):
            raise _ClaimLost(job_id)

    def _abandon(self, job_id: str) -> None:
        """Forget a job whose run was stopped: no status write and no heartbeat from here on.

        Whoever stopped it has the row, and between the stop and this call
        ``_persist`` already wrote nothing live over it. The run's own last
        word is the workflow's (``ingest_workflow._stopped``). A write of it
        still waiting for a retry is dropped by the next beat, as for any job
        no longer tracked (``_retry_unpersisted``).
        """
        with self._lock:
            self._jobs.pop(job_id, None)
        logger.warning("Ingestion job %s was stopped; this run ends without writing", job_id)

    def _job_config(self, prepared: PreparedIngestJob) -> dict[str, Any]:
        """This ingestor's config under the job's own, as ``_run_ingestion`` reads it."""
        return {**self.config, **prepared.config}

    def _prune_completed_jobs(self) -> None:
        """Remove terminal jobs older than the retention window.

        Without this, a long-lived backend accumulates one IngestionJobStatus
        (with full file_details) per upload for the life of the process.
        ``completed_at`` is an
        isoformat string on this adapter (get_file_status round-trips it via
        fromisoformat), so parse before comparing.
        """
        now = datetime.utcnow()
        with self._lock:
            stale = []
            for jid, job in self._jobs.items():
                if job.status not in (JobState.COMPLETED, JobState.FAILED):
                    continue
                completed_at = self._parse_timestamp(job.completed_at) if isinstance(job.completed_at, str) else None
                if completed_at is not None and (now - completed_at).total_seconds() > JOB_RETENTION_SECONDS:
                    stale.append(jid)
            for jid in stale:
                del self._jobs[jid]
        if stale:
            logger.debug("Pruned %d completed job(s) from tracking", len(stale))

    def get_job_status(self, job_id: str) -> IngestionJobStatus | None:
        """Get current status of an ingestion job, or None when no process and no shared record knows it."""
        self._prune_completed_jobs()
        with self._lock:
            local = self._jobs.get(job_id)
        if local is not None:
            return local.model_copy()
        return ingest_status_store.get(job_id)

    def _embed_fingerprint_metadata(self) -> dict[str, str]:
        """The embedding identity to stamp on collections this ingestor writes."""
        return embed_fingerprint_metadata(self.embed_model_name, self.embed_base_url)

    def _collection_info(self, name: str, chunk_count: int | None = None) -> CollectionInfo:
        """One collection as the store holds it: its chunks, its files, when it was first and last written.

        A collection is a scope on the store's points (ADR-0116), so there is
        nothing to look up besides them. The timestamps are the oldest and
        newest ``indexed_at`` its points carry; a collection whose points all
        predate the field states none, which the reaper reads as "skip".
        """
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
        """Answer for the collection ``name``; there is nothing to create.

        A collection is a scope on the points of one physical Qdrant collection
        (ADR-0116), which the first write creates once it knows the vector
        size. ``description`` is echoed and ``metadata`` dropped: nothing reads
        either back.
        """
        info = self._collection_info(name)
        return info.model_copy(update={"description": description}) if description else info

    def delete_collection(self, name: str) -> bool:
        """Delete every chunk of ``name`` and everything recorded about it.

        One store, one delete: it either took every chunk or raised, and the
        caller's retry (the purge, the reaper's next tick) starts over. The
        job records, summaries and the cached write version go after it.
        """
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

    def _parse_timestamp(self, iso_string: str | None) -> datetime | None:
        """Parse an ISO format timestamp string to datetime."""
        if not iso_string:
            return None
        try:
            return datetime.fromisoformat(iso_string)
        except ValueError, TypeError:
            return None

    def list_collections(self) -> list[CollectionInfo]:
        """Every collection with at least one chunk, from one facet per physical collection.

        Raises when the store cannot be read. A collection with no point is
        absent, which cannot tell "deleted" from "not imported yet", so the
        summary reconcile never judges a collection missing from it, and
        refuses outright when the list is empty (``routes/maintenance.py``).
        """
        from knowledge_layer.vector_store import Physical

        store = self._store()
        counts: dict[str, int] = {}
        for physical in Physical:
            counts.update(store.scope_counts(physical))
        result = [self._collection_info(name, count) for name, count in sorted(counts.items())]
        logger.info(f"Listed {len(result)} collections")
        return result

    def get_collection(self, name: str) -> CollectionInfo:
        """Metadata for one collection. Every name is one: an empty collection has no chunks yet.

        Raises when the store cannot be reached. Returned as "missing", an
        outage read as a wiped index: ``oib_sync`` once re-ingested the whole
        corpus over it.
        """
        return self._collection_info(name)

    def upload_file(
        self,
        file_path: str,
        collection_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> FileInfo:
        """
        Upload a file to a collection.

        This submits an ingestion job (``submit_job``) and returns the file as it
        stands: INGESTING, with the job to poll. The file is nowhere recorded
        but in that job; every later question about it is answered from there
        and from the chunks, by any process.
        """
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
        """The file name a ``file_id`` addresses: a listed id resolves to its file's name, anything else is a name.

        The frontend deletes by name; an id is what ``list_files`` and an
        upload response hand out, and is a UUID derived from the name
        (``stable_file_id``), so only a UUID needs the listing to be read back.
        """
        try:
            uuid.UUID(file_id)
        except ValueError:
            return file_id
        listed = next((f for f in self.list_files(collection_name) if f.file_id == file_id), None)
        return listed.file_name if listed is not None else file_id

    def delete_file(self, file_id: str, collection_name: str, *, permanent: bool = False) -> bool:
        """
        Delete a file and its chunks from a collection.

        ``permanent`` is a delete nobody undoes (an erase, a move to another
        collection). Without it the metadata row goes but the Fassung facts a
        person made on it are kept for the file's return: an archive, the folder
        bin and a publish purge and read the document again
        (``DocumentMetadataStore.unregister``).

        This removes all chunks that have the matching file_name in metadata.
        Handles both exact file names and names with tmp prefix stripped.
        The tmp pattern is tmp[8 random chars]_filename.

        The file_id parameter may be either the id ``list_files`` hands out or
        a human-readable filename (the frontend sends filenames); see
        ``_file_name_of``. A FAILED file has no chunks, and deleting it forgets
        the job record that is all there is of it (``ingest_status_store``).

        Deliberately does NOT take the replacement lock
        (:func:`_replacement_lock_key`). The ingestor holds it for the whole
        of a file's ingest, extraction and embedding included, so a delete
        behind it would wait minutes and outlast the BFF's request timeout. An
        ingest still running when this deletes inserts the rest of its chunks
        afterwards; it takes them back out itself once it has indexed, when
        the BFF answers that the document is gone
        (``document_presence``, ``_deleted_while_indexing``).

        Raises when the status store or Qdrant fails: a failure must never read
        as "nothing was there" (``delete_files`` reports it under ``failed``).
        """
        file_name = self._file_name_of(file_id, collection_name)
        forgotten = ingest_status_store.forget_file(collection_name, file_name)

        spellings = [
            stored
            for stored in self._store().file_counts(collection_name)
            if stored == file_name or _stored_name_matches(file_name, stored)
        ]
        chunk_ids = [chunk_id for chunk_id, _ in self._chunk_ids_of(collection_name, spellings)]

        from agent.knowledge import unregister_summary

        if not chunk_ids:
            if forgotten:
                logger.info(f"Removed {forgotten} job record(s) of file {file_name}")
            else:
                logger.warning(f"No chunks found for file_name={file_name}; clearing its summary")
            unregister_summary(collection_name, file_name, permanent=permanent)
            return forgotten > 0

        self._store().delete_chunks(collection_name, chunk_ids)
        bump_collection_version(collection_name)
        logger.info(f"Deleted {len(chunk_ids)} chunks for file {file_name}")
        unregister_summary(collection_name, file_name, permanent=permanent)
        return True

    def _indexed_files(self, collection_name: str) -> dict[str, FileInfo]:
        """``file_name -> FileInfo`` for each file the collection holds chunks of: the store says what is indexed."""
        records = self._store().scroll(collection_name, None, fields=LISTING_FIELDS, page_size=_LISTING_PAGE)
        return files_from_payloads(collection_name, (record.payload for record in records))

    @staticmethod
    def _recorded_files(collection_name: str) -> dict[str, FileInfo]:
        """``file_name -> FileInfo`` from the newest job that named the file, read from the shared status store."""
        records: dict[str, FileInfo] = {}
        for job in ingest_status_store.collection_jobs(collection_name, FILE_TRACKING_RETENTION_SECONDS):
            for detail in job.file_details:
                records[detail.file_name] = _file_info_from_job(job, detail)
        return records

    def list_files(self, collection_name: str) -> list[FileInfo]:
        """List all files in a collection, the same in every process.

        Two shared records make the answer, and neither is this process's
        memory: the chunks in Qdrant say which files are indexed, and the job
        rows in the status store say which are being read or failed, and why
        (``_merge_file_records``). A file's id is derived from its collection
        and name (``stable_file_id``), so two calls, and two processes, agree.
        """
        try:
            indexed = self._indexed_files(collection_name)
            recorded = self._recorded_files(collection_name)

            result = []
            for file_name in {**indexed, **recorded}:
                merged = _merge_file_records(indexed.get(file_name), recorded.get(file_name))
                if merged is not None:
                    result.append(merged)

            logger.info(f"Listed {len(result)} files in {collection_name}")
            return result

        except Exception as e:
            logger.error(f"Failed to list files in {collection_name}: {e}")
            return []

    def get_file_status(self, file_id: str, collection_name: str) -> FileInfo | None:
        """Get the current status of a file: its entry in ``list_files``, so the same in every process."""
        return next((f for f in self.list_files(collection_name) if f.file_id == file_id), None)

    def get_document_text_sample(self, collection_name: str, file_name: str, max_chars: int = 4000) -> str | None:
        """Return representative text for an already-indexed file (fail-open).

        Only the reconciliation backfill (``factory.reconcile_collection_summaries``,
        which duck-types it) uses it: a fallback summary for an indexed file the
        summaries table lacks, from its first chunks in reading order (no
        embedding), capped at ``max_chars``. ``None`` on any failure or no text.
        It is the platform's own sweep over every office's collections, so it
        reads under ``reading_for_maintenance`` and names no office (ADR-0163).
        """
        from knowledge_layer.vector_store import reading_for_maintenance
        from knowledge_layer.vector_store import reads as qdrant_reads

        from agent.knowledge.base import READING_ORDER

        try:
            with reading_for_maintenance():
                hits = qdrant_reads.fetch(collection_name, {"file_name": file_name}, 5, READING_ORDER)
        except Exception as e:
            logger.warning("Reconciliation: failed to fetch chunks for %s in %s: %s", file_name, collection_name, e)
            return None

        combined = "\n".join(hit.text for hit in hits[:5] if hit.text)
        return combined[:max_chars] if combined else None

    def get_document_visual_details(self, collection_name: str, file_name: str) -> list[dict[str, Any]]:
        """Per-page VLM descriptions of a document's visual chunks (fail-open).

        Powers the file-preview "detailed information" section: returns the
        rendered-drawing / image / chart captions ingestion produced, so the
        rich description (drawing type, scale, materials, spatial relationships,
        detailed paragraph) the summary is distilled from is browsable — not just
        reachable via chat retrieval. Duck-typed (not on ``BaseIngestor``) like
        :meth:`get_document_text_sample`. Returns ``[]`` on any lookup failure or
        when the document has no visual chunks.

        Each item: ``{page, content_type, drawing_type, scale, text, segment,
        segment_count, structured}`` where ``text`` is the caption body (the
        ``[DRAWING from page N]`` prefix stripped), ``segment`` is the drawing's
        index on its sheet (0 for v1 chunks and non-drawings), ``segment_count``
        is how many depictions share that sheet (1 for the same legacy rows),
        and ``structured`` is the parsed v2 ``drawing_data`` payload (``None``
        for v1 chunks and non-drawings). Sorted by page, then content type,
        then segment.
        """
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
            content_type = meta.get("content_type")
            if not text:
                continue
            body = text.split("\n\n", 1)[1] if "\n\n" in text else text
            try:
                page = int(meta.get("page_label") or 0)
            except TypeError, ValueError:
                page = 0
            try:
                segment = int(meta.get("segment_index") or 0)
            except TypeError, ValueError:
                segment = 0
            try:
                segment_count = max(1, int(meta.get("segment_count") or 1))
            except TypeError, ValueError:
                segment_count = 1
            structured = None
            raw_data = meta.get("drawing_data")
            if raw_data:
                try:
                    structured = json.loads(raw_data)
                except TypeError, ValueError:
                    structured = None
            items.append(
                {
                    "page": page,
                    "content_type": content_type,
                    "drawing_type": meta.get("drawing_type") or "",
                    "scale": meta.get("drawing_scale") or "",
                    "text": body.strip(),
                    "segment": segment,
                    "segment_count": segment_count,
                    "structured": structured,
                }
            )

        items.sort(key=lambda it: (it["page"], it["content_type"], it["segment"]))
        return items

    def _thumbnail_after_screen(self, thumbnail_upload_url: str | None, image_path: str | None) -> None:
        """Draw the file card's thumbnail, called only once the file's screening passed.

        Upload screening (ADR-0086) holds a file back until its content gate
        passes, and a thumbnail is a derivative of that content: a first-page
        render of a fee agreement shows the fee. It used to be drawn first, for
        speed, so a quarantined file had one before its verdict, and the route
        drew a spreadsheet's from its rendition before the job had read a
        word. Every call site sits after the screen: a PDF's (or a rendition's)
        text screen, an image's name-only pass, an office file's extracted text.
        """
        if thumbnail_upload_url and image_path:
            self._generate_and_upload_thumbnail(image_path, thumbnail_upload_url)

    @staticmethod
    def _generate_and_upload_thumbnail(
        file_path: str,
        thumbnail_upload_url: str,
    ) -> None:
        """Generate a 400px-wide JPEG thumbnail and upload it via the presigned URL.

        The file cards render the thumbnail header up to ~236px wide, so a 400px
        source keeps it crisp on standard displays and stays reasonable on
        high-DPI (retina) screens where a smaller source would look soft.
        """
        import io

        from PIL import Image
        from PIL import ImageOps

        THUMBNAIL_MAX_DIM = 400

        is_pdf = _looks_like_pdf(file_path)
        image_format = _looks_like_image(file_path)
        is_image = image_format is not None

        pil_image: Image.Image | None = None

        if is_pdf:
            try:
                pil_image = _render_first_pdf_page(file_path, scale=2)
            except Exception:
                logger.warning("Failed to render PDF page for thumbnail", exc_info=True)
                return
        elif is_image:
            try:
                pil_image = Image.open(file_path)
                pil_image.load()
                pil_image = ImageOps.exif_transpose(pil_image)
                if pil_image.mode != "RGB":
                    pil_image = pil_image.convert("RGB")
            except Exception:
                logger.warning("Failed to open image for thumbnail", exc_info=True)
                return
        else:
            return  # Not a previewable type

        pil_image.thumbnail((THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM))
        buf = io.BytesIO()
        pil_image.save(buf, format="JPEG", quality=80)
        thumbnail_bytes = buf.getvalue()

        try:
            with connect_retrying_client(read_timeout=5.0) as client:
                resp = client.put(
                    thumbnail_upload_url,
                    content=thumbnail_bytes,
                    headers={"Content-Type": "image/jpeg"},
                )
                resp.raise_for_status()
            logger.info("Uploaded thumbnail (%d bytes)", len(thumbnail_bytes))
        except Exception as error:
            logger.warning("Failed to upload thumbnail: %s", type(error).__name__)

    def _find_previous_versions(self, collection_name: str, incoming_names: list[str]) -> dict[str, _PreviousVersion]:
        """Find the chunks of any EARLIER upload of these file names, keyed by
        normalized name, so a re-upload can REPLACE its predecessor instead of
        coexisting with it. Reads only; nothing is deleted here.

        Law does not go stale, it gets replaced — and the OIB sync already has
        replacement semantics through its hash registry. Uploaded office and
        project documents had none: re-uploading `statik-standard.pdf` appended
        a second full set of chunks next to the first, and both versions then
        competed in retrieval on similarity alone, so an answer could cite the
        superseded one with full confidence. The newest upload of a name is the
        version the user means; this enforces exactly that, per collection.

        The old version is retired by :meth:`_retire_previous_version` only
        once the new one is in the vector store. Deleting it first, as this
        step once did, meant a re-upload that then failed (an encrypted PDF, an
        empty extraction, a missing VLM key) left the document with no chunks
        at all: the user replaced a working version with nothing. Retiring
        afterwards means both versions are retrievable for the length of the
        job, which is the smaller harm.

        Matching mirrors delete_file's normalization (tmp[8]_ prefix strip plus
        percent-decoding), because stored names carry either form depending on
        how the file reached the backend. The read is a ``file_name`` filter over
        the spellings a stored version can carry (:func:`_stored_spellings`,
        plus the tmp-prefixed names the metadata rows know), so it costs the
        chunks of the files being replaced, not the collection: it used to read
        every chunk's metadata, which on the OIB corpus was one full scan per
        PDF. A legacy tmp-prefixed version with no metadata row is not found,
        and stays beside its re-upload as it always did, and so is one whose
        row the metadata store could not be asked about (logged).

        Raises when Qdrant cannot answer after the store's retries
        (``store.with_retry``). "No predecessor" would let the write go on and
        leave both versions answering every search; the write needs Qdrant
        anyway, so the file fails before anything is written, where a person
        sees it and the previous version stays whole.

        The caller holds :func:`_replacement_lock_key`'s lock from here until
        the file has been retired or discarded: two jobs for one name would
        otherwise both collect the same predecessor and both keep their own
        new version.

        Deliberately name-based only: a NEW name is a new document, even when
        its content supersedes an old one. Detecting renamed versions
        semantically would guess, and a wrong guess silently deletes a document
        someone still cites — the human-classification-wins rule applies.

        Each entry also carries what people set on the previous version's
        metadata row (``doc_class``, ``display_title``, ``folder_path``). A row
        stored under the same name is the new version's row too and keeps them
        by itself; one stored under another spelling (a ``tmp`` prefix,
        percent-encoding) is dropped at retirement, and the new row takes them
        over from here.
        """
        from knowledge_layer.vector_store import with_retry

        found: dict[str, _PreviousVersion] = {}
        normalize = _normalized_file_name
        targets = {normalize(name) for name in incoming_names if name}
        targets.discard("")
        if not targets:
            return found
        spellings = {spelling for name in incoming_names if name for spelling in _stored_spellings(name)}
        spellings.update(_tmp_upload_names(collection_name, sorted(spellings)))
        chunks = with_retry(
            f"read the previous versions in {collection_name}",
            lambda: self._chunk_ids_of(collection_name, sorted(spellings)),
        )
        for chunk_id, stored in chunks:
            if normalize(stored) not in targets:
                continue
            version = found.setdefault(normalize(stored), _PreviousVersion())
            version.chunk_ids.append(chunk_id)
            if stored not in version.stored_names:
                version.stored_names.append(stored)
        if found:
            _read_human_set_fields(collection_name, found)
        return found

    def _retire_previous_version(
        self, collection_name: str, file_name: str, previous: _PreviousVersion | None, written: list[str] | None = None
    ) -> None:
        """Delete a replaced version once its successor is in the vector store.

        By the chunk ids collected before the job, never by name: the new
        version carries the same ``file_name`` and would go with it. Chunk ids
        are deterministic (``chunk_identity``), so a re-read of the same bytes
        wrote some of those ids again: ``written`` is left out. For the
        same reason the metadata row is dropped only under a stored spelling
        OTHER than ``file_name``: the row under ``file_name`` is the new
        version's row, and keeping it is what keeps the Dokumentart, title and
        folder a person set.
        """
        if previous is None or not previous.chunk_ids:
            return
        from .chunk_identity import ids_only_in

        try:
            from agent.knowledge import unregister_summary

            self._store().delete_chunks(collection_name, ids_only_in(previous.chunk_ids, written))
            bump_collection_version(collection_name)
            for stored in previous.stored_names:
                if stored != file_name:
                    unregister_summary(collection_name, stored, permanent=True)
            logger.info(
                "Replaced previous version(s): removed %d chunk(s) of %s from %s after re-ingest",
                len(previous.chunk_ids),
                sorted(previous.stored_names),
                collection_name,
            )
        except Exception:  # noqa: BLE001 — the new version is in; retiring the old must not fail it
            logger.warning(
                "Could not remove the previous version of %s after ingest; duplicate chunks may remain",
                file_name,
                exc_info=True,
            )

    def _quarantined(self, job: IngestionJobStatus, file_index: int) -> bool:
        """Whether this job's upload screen quarantined file ``file_index``."""
        with self._lock:
            return file_index < len(job.file_details) and job.file_details[file_index].screening == "quarantined"

    def _retire_held_predecessor(self, collection_name: str, file_name: str, previous: _PreviousVersion) -> None:
        """Take a quarantined re-upload's predecessor out of retrieval.

        A quarantine holds the whole document from everyone but its uploader and
        its reviewers (ADR-0086), the earlier screened version included, and it
        lasts until a reviewer releases or deletes it, not for the minutes a
        reading takes. Its earlier chunks would answer retrieval for a document
        no member may open, so they go now, by the ids collected before the
        job, exactly as :meth:`_retire_previous_version` takes them.

        Unlike that retirement no metadata row goes, under any spelling: no new
        version has written its row, and the rows carry what people set (the
        Dokumentart, the title), which the release's reading takes over. A
        failed re-upload is not handled here: its uploader retries it, and the
        version it could not replace stays meanwhile, as it always has.
        """
        if not previous.chunk_ids:
            return
        try:
            self._store().delete_chunks(collection_name, previous.chunk_ids)
            bump_collection_version(collection_name)
            logger.info(
                "Took %d chunk(s) of the previous version of a quarantined re-upload out of %s",
                len(previous.chunk_ids),
                collection_name,
            )
        except Exception:  # noqa: BLE001 — the verdict stands; a failed retire must not mask it
            logger.warning(
                "Could not take the previous version of a quarantined re-upload out of %s; it still answers",
                collection_name,
                exc_info=True,
            )

    def _discard_partial_version(
        self, collection_name: str, file_name: str, attempted: list[str] | None, kept: _PreviousVersion | None = None
    ) -> None:
        """Delete what a failed attempt wrote, and nothing it found there.

        A file can fail after some of its chunks are in (a write batch times
        out halfway through a long PDF). Those chunks carry the same
        ``file_name`` as the previous version the failure keeps, so left alone
        they sat beside it: part of a version nobody meant to publish,
        retrieved with it. ``attempted`` is every chunk id this attempt sent,
        and an id that never landed deletes nothing. None: nothing was sent.
        The ids are deterministic (``chunk_identity``): one the kept version
        also holds (``kept``, a re-read of the same bytes) is that version's
        chunk, written over with the same text, and stays.
        """
        from .chunk_identity import ids_only_in

        attempted = ids_only_in(attempted or [], kept.chunk_ids if kept is not None else None)
        if not attempted:
            return
        try:
            self._store().delete_chunks(collection_name, attempted)
            bump_collection_version(collection_name)
            logger.warning(
                "Discarded up to %d chunk(s) a failed ingest of %s left in %s",
                len(attempted),
                file_name,
                collection_name,
            )
        except Exception:  # noqa: BLE001 — the file already reads FAILED; this must not mask why
            logger.warning(
                "Could not discard the partial chunks of %s; they sit beside the kept version", file_name, exc_info=True
            )

    def _embedded_records(
        self, documents: list[Any], *, chunk_size: int, chunk_overlap: int, version: Any = None
    ) -> list[Any]:
        """``documents`` split into chunks and embedded, through the embedding cache (``chunk_identity``).

        The model and its fingerprint are this ingestor's, never a global's. With
        ``version`` (a ``ChunkVersion``) each record's id is deterministic.
        """
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
        """True only when the BFF says the dispatched document is gone.

        Asked once the file is in the vector store and before its predecessor
        is retired (``knowledge_layer.ingest.document_presence`` has the
        two windows this closes). A job with no ``document_id`` was not
        dispatched for a BFF row (the OIB corpus sync, ``/v1/documents``) and
        is never asked about. Anything short of a definite "gone" reads as
        present: an unreachable BFF must not cost a live document its chunks.
        """
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
        """Hand a Bescheid's permit record to the BFF (permitting memory), fail-open and bounded.

        Runs once the tags are known, and only when the job names the BFF row it was
        dispatched for. A Bescheid is read: the extraction is a second model call over the
        whole document, so it gets its own deadline, and a slow model costs the record,
        never the ingest.

        A document the tag decision positively typed as another kind (a document-type tag
        other than Bescheid and Sonstiges, ``typed_as_something_else``) has its record
        dropped, with no model call and under a short deadline, so a re-typed document
        stops answering as a permit. Anything less is no decision: ``None`` (the tagger
        timed out or failed, the classifier abstained, summaries are off), discipline tags
        alone (the fallback drops an off-vocabulary type), or Sonstiges. Placement
        re-ingests on every move, so dropping on any of them would erase a real Bescheid's
        record whenever the tagger was slow or unsure (docs/design/permitting-memory.md).
        """
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
                    PERMIT_RECORD_DROP_TIMEOUT_SECONDS,
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
            PERMIT_RECORD_TIMEOUT_SECONDS,
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
        """Run ``work`` on its own thread under ``timeout``: past it, or on a fault, the ingest goes on without it.

        Positional-only, so ``work``'s own keywords (``file_name``) pass through untouched.
        """
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
        """Background ingestion worker, under the uploading organization's data policy and on the cost ledger.

        The job runs detached, with no request to read an organization from, so
        the policy is entered here from the org the job config names: every model
        call the job makes on a model the organization chose (the ingest VLM,
        page transcription) follows its zero-data-retention setting. A job with
        no organization (the base corpus sync) is pinned anyway.

        Every model call the job makes (vision, transcription, summary, tags,
        embeddings) is also recorded under ``activity = ingest`` for the job's
        organization, and its project and uploader when the request named them.
        No budget is enforced here: a document half-read because a limit ran out
        mid-job is worse than the overrun, and the spend still lands in the
        budgets it counts toward.

        The job's ``priority`` (``interactive`` or ``bulk``) is its class at the
        provider limiter (ADR-0081): a reindex yields to an office's own upload,
        and both yield to a person waiting on an answer.
        """
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
        """Background ingestion worker with optional multimodal extraction."""
        from knowledge_layer.ingest.deferred_files import ORIGINAL_DOWNLOAD_FAILED
        from knowledge_layer.ingest.deferred_files import resolve_original
        from knowledge_layer.ingest.renditions import OFFICE_RENDITION_REQUIRED
        from knowledge_layer.ingest.renditions import delete_quietly
        from knowledge_layer.ingest.renditions import handed_rendition_paths
        from knowledge_layer.ingest.renditions import requires_rendition
        from knowledge_layer.ingest.renditions import resolve_preview
        from knowledge_layer.ingest.renditions import resolve_rendition

        downloaded: list[str] = []
        try:
            from knowledge_layer.ingest.reader_version import INGEST_READER_VERSION

            with self._lock:
                job = self._jobs[job_id]
                job.status = JobState.PROCESSING
                job.started_at = datetime.utcnow()
                job.reader_version = INGEST_READER_VERSION
            self._persist(job)

            self._ensure_initialized()

            chunk_size = config.get("chunk_size", self.chunk_size)
            chunk_overlap = config.get("chunk_overlap", self.chunk_overlap)

            extract_tables = config.get("extract_tables", self.extract_tables)
            extract_images = config.get("extract_images", self.extract_images)
            extract_charts = config.get("extract_charts", self.extract_charts)

            organization_id = config.get("organization_id")
            vlm_cred = resolve_vlm_credential(organization_id)
            vlm_api_key = vlm_cred.api_key
            vlm_base_url = config.get("vlm_base_url") or vlm_cred.base_url
            base_vlm_model = config.get("vlm_model", self.vlm_model)
            vlm_override = _resolve_vlm_model_override(organization_id)
            vlm_model = vlm_override or base_vlm_model
            from knowledge_layer.ingest import transcription as _transcription

            ocr_model = _transcription.resolve_ocr_model(base_vlm_model, vlm_override)

            from knowledge_layer.vector_store import get_store

            identity = self._embed_fingerprint_metadata()
            get_store(identity).check_identity(collection_name)

            total_chunks = 0
            total_tables = 0
            total_charts = 0
            total_images = 0

            original_filenames = config.get("original_filenames", [])

            from knowledge_layer.ingest.screening import ScreeningRules
            from knowledge_layer.ingest.screening import document_pages

            from agent.common.content_screen import screening_config_unusable

            screening_rules = ScreeningRules.from_config(config.get("screening"))
            screening_unusable = screening_config_unusable(config.get("screening"))

            kept_previous: list[str] = []
            for i, file_entry in enumerate(file_paths):
                self._assert_still_owner(job_id)
                if self._deleted_while_indexing(config, collection_name):
                    self._update_file_status(job, i, FileStatus.FAILED, error=DOCUMENT_DELETED_DURING_INGEST)
                    logger.info("Skipped file %d of job %s: its document was deleted before it was read", i + 1, job_id)
                    continue
                if screening_unusable:
                    self._update_file_status(job, i, FileStatus.FAILED, error=SCREENING_UNAVAILABLE)
                    logger.warning("Held file %d of job %s: its screening policy could not be applied", i + 1, job_id)
                    continue
                file_path = resolve_original(file_entry, downloaded)
                if file_path is None:
                    self._update_file_status(job, i, FileStatus.FAILED, error=ORIGINAL_DOWNLOAD_FAILED)
                    continue
                file_scope = contextlib.ExitStack()
                previous = None
                retired = False
                deleted = False
                attempted: list[str] | None = None
                file_name = original_filenames[i] if i < len(original_filenames) else Path(file_path).name
                file_started = time.monotonic()
                _log_memory(f"file:start {file_name}")
                rendition = resolve_rendition(config, i, downloaded)
                source_path = rendition or file_path
                stages: dict[str, float] = {}
                file_trace = _file_trace(file_name, config, job_id)
                file_recorder = file_trace.__enter__()
                coverage = None
                try:
                    file_size = os.path.getsize(file_path)

                    from agent.knowledge.leader_lock import keyed_lock

                    file_scope.enter_context(keyed_lock(_replacement_lock_key(collection_name, file_name)))
                    previous = self._find_previous_versions(collection_name, [file_name]).get(
                        _normalized_file_name(file_name)
                    )

                    from agent.common.norm_registry import guess_doc_class
                    from agent.common.source_kinds import legacy_shelf_for_collection_name
                    from agent.knowledge import get_document_doc_class

                    preserved = previous.preserved if previous else {}
                    row_doc_class = get_document_doc_class(collection_name, file_name)
                    stored_doc_class = row_doc_class or preserved.get("doc_class")
                    base_corpus = legacy_shelf_for_collection_name(collection_name) is None
                    from agent.knowledge.document_classification import canonical_doc_class

                    explicit_doc_class = canonical_doc_class(config.get("doc_class"))
                    doc_class = (
                        explicit_doc_class or stored_doc_class or (guess_doc_class(file_name) if base_corpus else None)
                    )
                    is_pdf = (
                        rendition is not None
                        or file_name.lower().endswith(".pdf")
                        or Path(file_path).suffix.lower() == ".pdf"
                        or _looks_like_pdf(file_path)
                    )
                    from knowledge_layer.ingest.image_ingest import standalone_image_format

                    image_format = None if is_pdf else standalone_image_format(file_path, file_name)
                    is_image = image_format is not None
                    photo = None
                    coverage = None

                    mode_str = "multimodal" if is_image or (is_pdf and (extract_tables or extract_images)) else "text"
                    logger.info(f"Processing file {i + 1}/{len(file_paths)} (mode={mode_str})")

                    with self._lock:
                        if i < len(job.file_details):
                            job.file_details[i].status = FileStatus.INGESTING
                            job.file_details[i].progress_percent = (i / len(file_paths)) * 100

                    thumbnail_upload_url = config.get("thumbnail_upload_url")

                    all_documents = []

                    text_pages: list[dict[str, Any]] = []
                    companions: list[Any] = []
                    tables: list[dict[str, Any]] = []
                    table_documents: list[Any] = []
                    if is_pdf:
                        from knowledge_layer.ingest import parsed_store

                        with _stage(stages, "text"):
                            parse = file_scope.enter_context(
                                parsed_store.open_for(config, collection_name, source_path)
                            )
                            text_pages = parse.text_pages(source_path)
                        dense_pages = getattr(text_pages, "dense_pages", [])
                        _log_memory(f"text:done pages={len(text_pages)} without_layout={len(dense_pages)}")
                        if dense_pages:
                            self._record_file_counts(job, i, pages_read_without_layout=len(dense_pages))
                        unreadable = unreadable_pdf_verdict(text_pages)
                        if unreadable:
                            self._update_file_status(job, i, FileStatus.FAILED, error=unreadable)
                            logger.warning("Failing %s: %s", file_name, unreadable)
                            continue
                        self._record_failed_pages(job, i, text_pages)
                        if rendition:
                            companions = _rendition_companions(file_path, file_name, file_size)
                        with _stage(stages, "screen"):
                            screen = self._screen_pdf(
                                job,
                                i,
                                screening_rules,
                                source_path,
                                text_pages,
                                companions,
                                captions_rasters=bool(vlm_api_key) and (extract_images or extract_charts),
                            )
                        if screen is None:
                            continue
                        if extract_tables:
                            from knowledge_layer.ingest.section_chunking import uncaptioned_table_documents

                            taken = {page["page_number"]: page.get("table_boxes") or [] for page in text_pages}
                            skip = _table_pass_skips(
                                dense_pages,
                                screen.triage,
                                vision_reads=bool(vlm_api_key) and RENDER_VISUAL_PAGES,
                            )
                            with _stage(stages, "tables"):
                                tables = parse.tables(source_path, taken, skip)
                            _log_memory(f"tables:done tables={len(tables)}")
                            table_documents = [
                                document
                                for table in tables
                                for document in uncaptioned_table_documents(table, file_name, file_size)
                            ]
                            with _stage(stages, "screen"):
                                held = self._screen_tables(job, i, screening_rules, table_documents, screen.checked)
                            if held:
                                continue
                        parse.save()  # the screen passed: what was parsed is stored for a retry
                        from knowledge_layer.ingest import page_reads

                        reads = file_scope.enter_context(page_reads.file_page_reads())
                        vision = {"vlm_model": vlm_model, "vlm_base_url": vlm_base_url, "vlm_api_key": vlm_api_key}
                        if RENDER_VISUAL_PAGES and vlm_api_key:
                            reads.read_drawings_ahead(
                                screen.triage,
                                source_path,
                                cap=MAX_RENDERED_PAGES,
                                max_dim=PAGE_RENDER_MAX_DIM,
                                vision={**vision, "extract_charts": extract_charts},
                            )
                        with _stage(stages, "ocr"):
                            page_routes = _transcription.route_pdf_pages(
                                source_path,
                                text_pages,
                                page_texts_for_visual_heuristic(text_pages),
                                vlm_api_key=vlm_api_key,
                                model=ocr_model,
                                base_url=vlm_base_url,
                                min_text_chars=VISUAL_PAGE_MIN_TEXT_CHARS,
                                min_paths=VISUAL_PAGE_MIN_PATHS,
                                max_ocr_pages=MAX_OCR_PAGES,
                                max_dim=PAGE_RENDER_MAX_DIM,
                                **screen.routing(),
                            )
                        self._record_file_counts(job, i, **page_routes.counts())
                        changed = bool(page_routes.outcome.texts or page_routes.garbled_kept)
                        if changed and self._screen_transcribed(
                            job, i, screening_rules, text_pages, transcribed=bool(page_routes.outcome.texts)
                        ):
                            continue
                        self._thumbnail_after_screen(thumbnail_upload_url, source_path)
                        if page_routes.not_transcribed and not text_pages:
                            error = _transcription.SCAN_NEEDS_VLM
                            self._update_file_status(job, i, FileStatus.FAILED, error=error)
                            logger.warning("Scanned PDF not ingested (VLM not configured): %s", file_name)
                            continue
                        text_documents = _chunk(text_pages, file_name, file_size, _released(config, collection_name))
                    elif is_image:
                        from knowledge_layer.ingest.image_ingest import read_standalone_image

                        vision = {"vlm_model": vlm_model, "vlm_base_url": vlm_base_url, "vlm_api_key": vlm_api_key}
                        image = read_standalone_image(
                            self,
                            job,
                            i,
                            file_path=source_path,
                            file_name=file_name,
                            file_size=file_size,
                            image_format=image_format,
                            rules=screening_rules,
                            thumbnail_upload_url=thumbnail_upload_url,
                            vision={**vision, "extract_charts": extract_charts},
                            stages=stages,
                        )
                        photo, coverage, image_docs = image.photo, image.coverage, image.documents
                        if image_docs is None:
                            continue
                        text_documents = image_docs
                        if image_docs[0].metadata.get("content_type") == "chart":
                            total_charts += 1
                        else:
                            total_images += 1
                    elif requires_rendition(file_name, file_path):
                        self._update_file_status(job, i, FileStatus.FAILED, error=OFFICE_RENDITION_REQUIRED)
                        logger.warning("No PDF rendition to index %s from", file_name)
                        continue
                    else:
                        from knowledge_layer.ingest import office_extractors
                        from knowledge_layer.ingest.text_formats import extract_text_format_documents

                        with _stage(stages, "text"):
                            office_documents = office_extractors.extract_office_documents(
                                file_path, file_name, file_size
                            )
                            if office_documents is None:
                                office_documents = extract_text_format_documents(file_path, file_name, file_size)
                        over_cap = 0
                        if office_documents is not None:
                            text_documents = office_documents
                            over_cap = office_extractors.rows_over_cap(office_documents)
                            if over_cap:
                                self._record_file_counts(job, i, rows_over_cap=over_cap)
                        else:
                            from llama_index.core import SimpleDirectoryReader

                            text_documents = SimpleDirectoryReader(input_files=[file_path]).load_data()

                            for doc in text_documents:
                                doc.metadata["file_name"] = file_name
                                doc.metadata["file_size"] = file_size
                        cut = office_extractors.content_cut(text_documents)
                        checked = "partial" if over_cap or cut else "full"
                        with _stage(stages, "screen"):
                            held = self._screen_or_quarantine(
                                job, i, screening_rules, document_pages(text_documents), checked
                            )
                        if held:
                            continue
                        if thumbnail_upload_url:
                            self._thumbnail_after_screen(thumbnail_upload_url, resolve_preview(config, i, downloaded))

                    all_documents.extend(text_documents)
                    logger.info(f"  Text extraction: {len(text_documents)} documents")
                    all_documents.extend(companions)

                    drawing_pages: list[dict[str, Any]] = []

                    if is_pdf and extract_tables:
                        all_documents.extend(table_documents)
                        total_tables += len(tables)
                        logger.info(f"  Table extraction: {len(tables)} tables")

                    if is_pdf:
                        from knowledge_layer.ingest import processing as _processing

                        drawing_pages_raw: list[dict[str, Any]] = []
                        if RENDER_VISUAL_PAGES and vlm_api_key:
                            with _stage(stages, "renders"):
                                drawing_pages_raw = _processing.render_visual_pages_no_vlm(
                                    source_path,
                                    min_text_chars=VISUAL_PAGE_MIN_TEXT_CHARS,
                                    min_paths=VISUAL_PAGE_MIN_PATHS,
                                    max_pages=MAX_RENDERED_PAGES,
                                    max_dim=PAGE_RENDER_MAX_DIM,
                                    page_texts=page_texts_for_visual_heuristic(text_pages),
                                    only_pages=page_routes.drawing_pages,
                                )
                            drawing_over_cap = len(page_routes.drawing_pages or ()) - MAX_RENDERED_PAGES
                            if drawing_over_cap > 0:
                                self._record_file_counts(job, i, drawing_pages_over_cap=drawing_over_cap)

                        with _stage(stages, "rasters"):
                            images, images_over_cap, images_over_pixel_budget = _embedded_images_for_analysis(
                                source_path,
                                rendered_pages={page["page_number"] for page in drawing_pages_raw}
                                | page_routes.scan_pages,
                                enabled=extract_images or extract_charts,
                            )
                        if images_over_cap:
                            self._record_file_counts(job, i, images_over_cap=images_over_cap)
                        if images_over_pixel_budget:
                            self._record_file_counts(job, i, images_over_pixel_budget=images_over_pixel_budget)
                        if images and vlm_api_key:
                            self._record_unscreened_rasters(job, i)

                        with _stage(stages, "vision"):
                            image_results, drawing_pages = _processing.enrich_vlm_batch(
                                image_records=images,
                                drawing_pages=drawing_pages_raw,
                                vlm_model=vlm_model,
                                vlm_base_url=vlm_base_url,
                                vlm_api_key=vlm_api_key,
                                extract_charts=extract_charts,
                            )

                        from knowledge_layer.ingest.coverage import reading_coverage

                        coverage = reading_coverage(
                            page_count=getattr(text_pages, "page_count", 0) or len(text_pages),
                            text_pages=text_pages,
                            drawing_pages=page_routes.drawing_pages,
                            rendered=len(drawing_pages_raw),
                            read=len(drawing_pages),
                            transcribed=len(page_routes.outcome.texts),
                            transcription_failed=len(page_routes.outcome.failed),
                            transcription_over_cap=len(page_routes.outcome.over_cap),
                            not_transcribed=len(page_routes.not_transcribed),
                            vision_configured=bool(vlm_api_key) and RENDER_VISUAL_PAGES,
                        )

                        if config.get("document_id"):
                            from knowledge_layer.ingest import page_text_store

                            self._bounded(
                                "Page text",
                                file_name,
                                PAGE_TEXT_TIMEOUT_SECONDS,
                                page_text_store.store_page_text,
                                page_text_store.pdf_pages(
                                    text_pages,
                                    transcribed=page_routes.outcome.texts,
                                    ocr_model=ocr_model,
                                    drawings=drawing_pages,
                                    vision_model=vlm_model,
                                    tables=tables,
                                ),
                                page_count=getattr(text_pages, "page_count", 0) or len(text_pages),
                                failed_pages=getattr(text_pages, "failed_pages", ()),
                                document_id=str(config["document_id"]),
                                collection=collection_name,
                                organization_id=organization_id,
                            )

                        document_id = config.get("document_id")
                        if document_id and image_results:
                            from knowledge_layer.ingest import image_store as _image_store

                            _image_store.store_extracted_images(
                                image_results,
                                document_id=str(document_id),
                                collection=collection_name,
                                organization_id=organization_id,
                            )

                        from knowledge_layer.ingest.pdf_visuals import visual_documents_for_pdf

                        visuals = visual_documents_for_pdf(
                            image_results,
                            drawing_pages,
                            file_name=file_name,
                            file_size=file_size,
                            extract_images=extract_images,
                            extract_charts=extract_charts,
                        )
                        all_documents.extend(visuals.documents)
                        total_charts += visuals.charts
                        total_images += visuals.images

                    from knowledge_layer.ingest import enrichment as ingest_enrichment

                    from agent.knowledge.document_classification import DEFAULT_DOC_CLASS

                    enrichment = ingest_enrichment.start_enrichment(
                        self,
                        text_documents=text_documents,
                        drawing_pages=drawing_pages,
                        all_documents=all_documents,
                        file_name=file_name,
                        collection_name=collection_name,
                        organization_id=organization_id,
                        base_corpus=base_corpus,
                        suggest_class=stored_doc_class is None
                        and explicit_doc_class is None
                        and base_corpus
                        and doc_class == DEFAULT_DOC_CLASS,
                    )
                    file_scope.callback(enrichment.close)

                    valid_documents = [
                        doc for doc in all_documents if not _looks_like_raw_pdf_or_binary(doc.get_content())
                    ]
                    if len(valid_documents) != len(all_documents):
                        raise ValueError("Raw PDF/binary content detected; refusing to index")
                    if not valid_documents:
                        self._update_file_status(
                            job,
                            i,
                            FileStatus.FAILED,
                            error="No content extracted (file may be password-protected, corrupted, or empty)",
                        )
                        logger.warning("No indexable content extracted from %s", file_name)
                        continue
                    all_documents = valid_documents

                    provenance = provenance_from_config(config)
                    stamp_chunk_metadata(
                        all_documents,
                        doc_class=doc_class,
                        provenance=provenance,
                        chunk_size=chunk_size,
                        file_name=file_name,
                        source_format=filed_mail.source_format_from_config(config),
                    )

                    self._assert_still_owner(job_id)
                    from .chunk_identity import chunk_version

                    version = chunk_version(collection_name, config.get("document_id") or file_name, source_path)
                    with _stage(stages, "embedding"):
                        records = self._embedded_records(
                            all_documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap, version=version
                        )
                    self._assert_still_owner(job_id)
                    attempted = [record.chunk_id for record in records]
                    from knowledge_layer.vector_store import writes as qdrant_writes

                    with _stage(stages, "write"):
                        qdrant_writes.write_chunks(
                            collection_name, file_name, records, identity=identity, config=config
                        )

                    if self._deleted_while_indexing(config, collection_name):
                        self._discard_partial_version(collection_name, file_name, attempted)
                        attempted = None
                        deleted = True
                        self._update_file_status(job, i, FileStatus.FAILED, error=DOCUMENT_DELETED_DURING_INGEST)
                        logger.warning(
                            "Discarded the ingest of %s in %s: its document was deleted while it indexed",
                            file_name,
                            collection_name,
                        )
                        continue

                    chunks_created = len(records)
                    total_chunks += chunks_created

                    self._update_file_status(job, i, FileStatus.SUCCESS, chunks_created=chunks_created)
                    attempted = None
                    _log_memory(f"file:written {file_name} elapsed={time.monotonic() - file_started:.0f}s")

                    self._retire_previous_version(collection_name, file_name, previous, [r.chunk_id for r in records])
                    retired = True

                    found = ingest_enrichment.collect_enrichment(enrichment, stages, file_name)
                    summary, tags, topics, dossier = found.summary, found.tags, found.topics, found.dossier

                    if is_image and text_documents:
                        from agent.knowledge.document_classification import reconcile_image_tags

                        tags = reconcile_image_tags(
                            tags,
                            content_type=text_documents[0].metadata.get("content_type"),
                            segment_types=(doc.metadata.get("drawing_type") or "" for doc in text_documents),
                        )

                    chosen_type, tags = chosen_document_type.apply(config, tags)

                    self._remember_permit(config, collection_name, file_name, tags, text_documents)

                    if is_image and not summary and text_documents:
                        caption_text = _scrub_watermark_phrases(_strip_visual_marker(text_documents[0].get_content()))
                        summary = caption_text[:500] or None

                    if not summary and drawing_pages:
                        summary = _summary_from_drawing_fields(drawing_pages)

                    if not summary and text_documents:
                        from agent.knowledge.document_classification import fallback_summary_from_text

                        first_text = text_documents[0].get_content()
                        last_text = text_documents[-1].get_content() if len(text_documents) > 1 else ""
                        fallback_source = f"{first_text}\n{last_text}" if last_text else first_text
                        summary = fallback_summary_from_text(fallback_source)

                    confirmed_older = (config.get("revision_of") or config.get("fassung_of") or "").strip() or None
                    if base_corpus or len(file_paths) != 1:
                        confirmed_older = None
                    revision_model = bool(not base_corpus and self.generate_summary_enabled and self.summary_llm)

                    if summary:
                        revision_rows = (
                            revisions.read_rows(collection_name)
                            if not base_corpus and self.generate_summary_enabled and self.summary_llm
                            else []
                        )
                        summary_before = revisions.previous_summary(
                            revision_rows, previous.stored_names if previous else ()
                        )
                        from agent.knowledge import register_summary
                        from agent.knowledge import set_document_doc_class
                        from agent.knowledge import set_document_folder_path

                        register_summary(collection_name, file_name, summary, tags=tags, topics=topics)
                        revision_facts = row_facts.store_read_facts(
                            collection_name,
                            file_name,
                            all_documents,
                            photo=photo,
                            config=config,
                            replaced=previous is not None,
                        )

                        from agent.knowledge import set_document_reading

                        reading, references = _reading_of(
                            all_documents,
                            dossier,
                            _predecessor_dossier(
                                revision_rows, previous.stored_names if previous else (), confirmed_older
                            ),
                        )
                        set_document_reading(
                            collection_name, file_name, dossier=reading, references=references, coverage=coverage
                        )

                        if row_doc_class is None or explicit_doc_class is not None:
                            set_document_doc_class(collection_name, file_name, doc_class)
                        suggestion = _future_result(enrichment.doc_class, "Dokumentart suggestion", file_name)
                        if suggestion or previous is not None:
                            from agent.knowledge import set_document_doc_class_suggestion

                            set_document_doc_class_suggestion(collection_name, file_name, suggestion)

                        folder_path = (config.get("folder_path") or "").strip() or None
                        folder_path = folder_path or preserved.get("folder_path")
                        if folder_path:
                            set_document_folder_path(collection_name, file_name, folder_path)
                        chosen_document_type.carry_person_tags(collection_name, file_name, preserved, chosen_type, tags)
                        if "topics" in preserved:
                            from agent.knowledge import set_document_topics_by_person

                            set_document_topics_by_person(collection_name, file_name, json.loads(preserved["topics"]))
                        if preserved.get("display_title"):
                            from agent.knowledge import set_document_display_title

                            set_document_display_title(collection_name, file_name, preserved["display_title"])
                        elif base_corpus:
                            from agent.common.norm_registry import guess_display_title
                            from agent.knowledge import set_document_display_title

                            default_title = guess_display_title(file_name)
                            if default_title:
                                set_document_display_title(collection_name, file_name, default_title)

                        if provenance or previous is not None:
                            from agent.knowledge import set_document_provenance

                            set_document_provenance(collection_name, file_name, provenance)

                        carried_link, carried_suggestion = revisions.carried_links(preserved)
                        if carried_link:
                            from agent.knowledge import set_document_superseded_by

                            set_document_superseded_by(collection_name, file_name, carried_link)
                        if carried_suggestion:
                            from agent.knowledge import set_document_revision_suggestion

                            set_document_revision_suggestion(collection_name, file_name, carried_suggestion)

                        if revision_model:
                            self._bounded(
                                "Fassung",
                                file_name,
                                REVISION_TIMEOUT_SECONDS,
                                revisions.record_revisions,
                                collection_name,
                                file_name,
                                replaced=previous is not None,
                                rows=revision_rows,
                                previous=summary_before,
                                summary=summary,
                                doc_class=doc_class,
                                tags=tags,
                                llm=self.summary_llm,
                                confirmed_older=confirmed_older,
                                revision_facts=revision_facts,
                            )

                        logger.info(f"  Summary generated ({len(summary)} chars)")

                    if confirmed_older and not (summary and revision_model):
                        self._bounded(
                            "Fassung",
                            file_name,
                            REVISION_TIMEOUT_SECONDS,
                            revisions.confirm_revision,
                            collection_name,
                            file_name,
                            confirmed_older,
                            summary=summary or "",
                            doc_class=doc_class,
                            tags=tags,
                            llm=None,
                        )

                    logger.info(f"Completed file {i + 1}/{len(file_paths)} ({chunks_created} chunks)")

                except _ClaimLost:
                    raise
                except Exception as e:
                    logger.exception(f"Error processing file {file_path}")
                    self._update_file_status(job, i, FileStatus.FAILED, error=str(e), exc=e)
                    self._discard_partial_version(collection_name, file_name, attempted, previous)
                finally:
                    _log_ingest_perf(file_name, stages)
                    _finish_file_trace(file_recorder, job, i, stages, coverage)
                    file_trace.__exit__(None, None, None)
                    _release_memory(file_name)
                    if previous is not None and not retired and not deleted and self._quarantined(job, i):
                        self._retire_held_predecessor(collection_name, file_name, previous)
                        retired = True
                    file_scope.close()
                    if previous is not None and not retired and not deleted:
                        kept_previous.append(file_name)

            for name in kept_previous:
                logger.warning(
                    "Kept the previous version of %s in %s: its re-upload did not index", name, collection_name
                )

            mode_parts = ["text"]
            if extract_tables:
                mode_parts.append("tables")
            if extract_charts:
                mode_parts.append("charts")
            if extract_images:
                mode_parts.append("images")
            extraction_mode = "multimodal" if len(mode_parts) > 1 else "text-only"

            failed_files = [f for f in job.file_details if f.status == FileStatus.FAILED]
            successful_files = [f for f in job.file_details if f.status == FileStatus.SUCCESS]

            if successful_files:
                try:
                    from agent.knowledge.factory import reconcile_collection_summaries

                    reconcile_collection_summaries(
                        self,
                        collection_name,
                        file_names=[f.file_name for f in successful_files],
                    )
                except Exception as e:
                    logger.warning("Reconciliation failed for collection %s: %s", collection_name, e)

            with self._lock:
                if failed_files and not successful_files:
                    job.status = JobState.FAILED
                    job.error_message = f"{len(failed_files)}/{len(job.file_details)} file(s) failed"
                else:
                    job.status = JobState.COMPLETED
                job.completed_at = datetime.utcnow().isoformat()
                job.metadata = {
                    **job.metadata,
                    "total_chunks": total_chunks,
                    "text_chunks": total_chunks - total_tables - total_charts - total_images,
                    "tables_extracted": total_tables,
                    "charts_extracted": total_charts,
                    "images_captioned": total_images,
                    "collection_name": collection_name,
                    "embed_model": self.embed_model_name,
                    "extraction_mode": extraction_mode,
                }

            self._persist(job)

            bump_collection_version(collection_name)

            logger.info(
                f"LlamaIndex ingestion completed: {job_id} "
                f"(chunks={total_chunks}, tables={total_tables}, charts={total_charts}, images={total_images})"
            )

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
                handed = [path for path in file_paths if isinstance(path, str)]
                for file_path in [*handed, *handed_rendition_paths(config)]:
                    try:
                        if os.path.exists(file_path):
                            os.unlink(file_path)
                            logger.debug(f"Cleaned up temp file: {file_path}")
                    except OSError as e:
                        logger.warning(f"Failed to clean up temp file {file_path}: {e}")
            delete_quietly(downloaded)

    def generate_summary(self, text_content: str, file_name: str) -> str | None:
        """Generate summary using NVIDIA NIM if enabled."""
        if not self.generate_summary_enabled:
            return None
        return _generate_document_summary(text_content, file_name, self.summary_llm)

    async def health_check(self) -> bool:
        """In-process ingestor - always healthy if code is running."""
        return True
