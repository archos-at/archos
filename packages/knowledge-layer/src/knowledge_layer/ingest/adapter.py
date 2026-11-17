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
from knowledge_layer.ingest.purge import ChunkPurgeMixin

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
from .pdfium_guard import close_bitmap
from .pdfium_guard import detached_pil
from .pdfium_guard import pdfium_lock
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
    ...


FILE_TRACKING_RETENTION_SECONDS = env_int("FILE_TRACKING_RETENTION_SECONDS", 86400)  # 24h

_PRUNE_EVERY_BEATS = 120


def bump_collection_version(collection_name: str) -> None:
    from agent.knowledge import collection_version as _collection_version

    _collection_version.bump(collection_name)


def resolve_vlm_credential(organization_id: str | None = None):
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
    return resolve_vlm_credential(organization_id=None).api_key


def vlm_configured() -> bool:
    return bool(resolve_vlm_api_key())


def _get_vlm_api_key() -> str:
    return resolve_vlm_api_key()


_PAGEOBJ_IMAGE = 3


def _extract_images_from_pdf(
    pdf_path: str,
    min_width: int = MIN_IMAGE_WIDTH_PX,
    min_height: int = MIN_IMAGE_HEIGHT_PX,
    skip_pages: set[int] | frozenset[int] = frozenset(),
) -> list[dict[str, Any]]:
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
    return [obj for obj in page.get_objects() if obj.type == _PAGEOBJ_IMAGE]


def _candidates_by_page(candidates: list[dict[str, Any]]) -> list[tuple[int, list[dict[str, Any]]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate["page_number"], []).append(candidate)
    return sorted(grouped.items())


def _decode_page_candidates(
    doc: Any, page_number: int, candidates: list[dict[str, Any]], seen_hashes: set[str]
) -> list[dict[str, Any]]:
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
    try:
        with open("/proc/self/statm", encoding="ascii") as statm:
            resident_pages = int(statm.read().split()[1])
        page_size = os.sysconf("SC_PAGE_SIZE")
    except OSError, ValueError, IndexError, AttributeError:
        return None
    return resident_pages * page_size / (1024 * 1024)


def _log_memory(stage: str) -> None:
    rss = _rss_mib()
    if rss is None:
        return
    logger.info("[ingest-mem] %s rss=%.0fMiB", stage, rss)


def _release_memory(file_name: str) -> None:
    import ctypes
    import gc

    gc.collect()
    with contextlib.suppress(OSError, AttributeError):
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    _log_memory(f"file:released {file_name}")


def _raster_record(
    pil_image: Any, page_number: int, img_idx: int, size: tuple[int, int], seen_hashes: set[str]
) -> dict[str, Any] | None:
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
    if len(images) <= max_images:
        return images, 0
    by_size = sorted(images, key=lambda image: image.get("width", 0) * image.get("height", 0), reverse=True)
    kept = sorted(by_size[:max_images], key=lambda image: (image["page_number"], image["image_index"]))
    return kept, len(images) - len(kept)


def _embedded_images_for_analysis(
    pdf_path: str, *, rendered_pages: set[int], enabled: bool
) -> tuple[list[dict[str, Any]], int, int]:
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
    if content_type == "chart":
        if extract_charts:
            return "chart"
        return "image" if extract_images else None
    return content_type if extract_images else None


def _table_pass_skips(dense_pages: Sequence[int], triage: Any, *, vision_reads: bool) -> list[int]:
    skip = set(dense_pages)
    if vision_reads and triage is not None:
        skip.update(sorted(triage.drawings)[:MAX_RENDERED_PAGES])
    return sorted(skip)


def _extract_tables_from_pdf(
    pdf_path: str, taken: dict[int, list[tuple]] | None = None, skip_pages: Sequence[int] = ()
) -> list[dict[str, Any]]:
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
    documents = text_documents_for_pages(text_pages, file_name, file_size)
    stamp_chunk_metadata(documents, doc_class=doc_class, provenance={}, chunk_size=chunk_size, file_name=file_name)
    return split_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def page_texts_for_visual_heuristic(text_pages: list[dict[str, Any]]) -> dict[int, str]:
    from knowledge_layer.ingest.captioned_tables import page_text_with_tables

    return {page["page_number"]: page_text_with_tables(page["text"], page.get("tables") or []) for page in text_pages}


def _looks_like_pdf(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as handle:
            return handle.read(5) == b"%PDF-"
    except OSError:
        return False


def _looks_like_image(file_path: str) -> str | None:
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
    from llama_index.core import Document

    from knowledge_layer.ingest import visual_analysis

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
    _, caption = _analyze_image_with_vlm(
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        extract_charts=is_chart,
    )
    return caption


def _parse_drawing_fields(caption: str) -> dict[str, str]:
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
    from agent.knowledge.dossier import MAX_FACTS
    from agent.knowledge.dossier import lifted_drawing_facts
    from agent.knowledge.dossier import own_document_type
    from knowledge_layer.references import extract_references

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
    wanted = [*stored_names, *([confirmed_older] if confirmed_older else [])]
    for name in wanted:
        row = next((row for row in rows if getattr(row, "file_name", None) == name), None)
        if row is not None and getattr(row, "dossier", None):
            return name, row.dossier
    return None


def _generate_document_summary(text_content: str, file_name: str, llm=None) -> str | None:
    from agent.knowledge.document_classification import summarize_document_text

    return summarize_document_text(text_content, file_name, llm)


_TMP_UPLOAD_PREFIX = re.compile(r"^tmp.{8}_")


def _rendition_companions(original_path: str, file_name: str, file_size: int) -> list[Any]:
    from knowledge_layer.ingest import office_extractors

    try:
        return office_extractors.extract_rendition_companions(original_path, file_name, file_size)
    except Exception as error:  # noqa: BLE001 — per-unit fail-open, named in the log
        logger.warning("Speaker notes of %s skipped: %s", file_name, type(error).__name__)
        return []


def _normalized_file_name(name: str | None) -> str:
    from urllib.parse import unquote

    return unquote(_TMP_UPLOAD_PREFIX.sub("", name or ""))


def _stored_name_matches(requested: str, stored: str) -> bool:
    from urllib.parse import unquote

    stripped = _TMP_UPLOAD_PREFIX.sub("", stored or "")
    return requested in (stripped, unquote(stripped))


def _stored_spellings(name: str) -> set[str]:
    from urllib.parse import quote

    plain = _normalized_file_name(name)
    return {name, plain, quote(plain), quote(plain, safe="!'()*~")}


def _replacement_lock_key(collection_name: str, file_name: str) -> str:
    return f"reingest:{collection_name}:{_normalized_file_name(file_name)}"


@dataclass
class _PreviousVersion:
    chunk_ids: list[str] = field(default_factory=list)
    stored_names: list[str] = field(default_factory=list)
    preserved: dict[str, str] = field(default_factory=dict)


def _tmp_upload_names(collection_name: str, spellings: list[str]) -> list[str]:
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


_LISTING_PAGE = 2048


class _PdfScreen(NamedTuple):
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
    start = time.perf_counter()
    try:
        yield
    finally:
        stages[name] = stages.get(name, 0.0) + (time.perf_counter() - start)


def _log_ingest_perf(file_name: str, stages: dict[str, float]) -> None:
    parts = [f"{name}={stages[name]:.3f}" for name in _INGEST_PERF_ORDER if name in stages]
    if parts:
        logger.info("[ingest-perf] %s %s", file_name, " ".join(parts))


@register_ingestor("llamaindex")
class LlamaIndexIngestor(TTLCleanupMixin, ChunkPurgeMixin, BaseIngestor):
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
            return [jid for jid, job in self._jobs.items() if job.status in (JobState.PENDING, JobState.PROCESSING)]

    def find_live_job(self, dispatch_key: str) -> str | None:
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
        if rules is None:
            return
        with self._lock:
            if file_index < len(job.file_details):
                job.file_details[file_index].screening = outcome
                job.file_details[file_index].quarantine = quarantine if outcome == "quarantined" else None

    def _record_unscreened_rasters(self, job: IngestionJobStatus, file_index: int) -> None:
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
        if rules is None:
            return False
        from knowledge_layer.ingest.screening import document_pages

        pages = document_pages(table_documents)
        if not any(text.strip() for _page, text in pages):
            return False
        return self._screen_or_quarantine(job, file_index, rules, pages, checked)

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
        self._prune_completed_jobs()
        with self._lock:
            local = self._jobs.get(job_id)
        if local is not None:
            return local.model_copy()
        return ingest_status_store.get(job_id)

    def _embed_fingerprint_metadata(self) -> dict[str, str]:
        return embed_fingerprint_metadata(self.embed_model_name, self.embed_base_url)

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

    def _parse_timestamp(self, iso_string: str | None) -> datetime | None:
        if not iso_string:
            return None
        try:
            return datetime.fromisoformat(iso_string)
        except ValueError, TypeError:
            return None

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

    def _indexed_files(self, collection_name: str) -> dict[str, FileInfo]:
        records = self._store().scroll(collection_name, None, fields=LISTING_FIELDS, page_size=_LISTING_PAGE)
        return files_from_payloads(collection_name, (record.payload for record in records))

    @staticmethod
    def _recorded_files(collection_name: str) -> dict[str, FileInfo]:
        records: dict[str, FileInfo] = {}
        for job in ingest_status_store.collection_jobs(collection_name, FILE_TRACKING_RETENTION_SECONDS):
            for detail in job.file_details:
                records[detail.file_name] = _file_info_from_job(job, detail)
        return records

    def list_files(self, collection_name: str) -> list[FileInfo]:
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
        if thumbnail_upload_url and image_path:
            self._generate_and_upload_thumbnail(image_path, thumbnail_upload_url)

    @staticmethod
    def _generate_and_upload_thumbnail(
        file_path: str,
        thumbnail_upload_url: str,
    ) -> None:
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
        with self._lock:
            return file_index < len(job.file_details) and job.file_details[file_index].screening == "quarantined"

    def _retire_held_predecessor(self, collection_name: str, file_name: str, previous: _PreviousVersion) -> None:
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

            from agent.common.content_screen import screening_config_unusable
            from knowledge_layer.ingest.screening import ScreeningRules
            from knowledge_layer.ingest.screening import document_pages

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

                    from agent.knowledge.document_classification import DEFAULT_DOC_CLASS
                    from knowledge_layer.ingest import enrichment as ingest_enrichment

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
                    from knowledge_layer.vector_store import write_chunks as qdrant_write_chunks

                    with _stage(stages, "write"):
                        qdrant_write_chunks(collection_name, file_name, records, identity=identity, config=config)

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
        if not self.generate_summary_enabled:
            return None
        return _generate_document_summary(text_content, file_name, self.summary_llm)

    async def health_check(self) -> bool:
        return True
