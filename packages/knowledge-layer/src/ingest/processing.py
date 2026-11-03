"""Unified document processing pipeline with concurrent VLM enrichment.

Provides a DRY, extensible extraction pipeline that:
- Runs VLM captioning concurrently for embedded images AND rendered drawing pages
  within a single file, on the file's page-read pool (``page_reads``), which its
  transcriptions share.
- Content-hash caches every VLM result via ``agent.common.cache`` so a
  re-ingest or cross-document duplicate image skips the API call entirely. The
  VLM model is part of the cache identity, so a model switch never serves
  stale captions produced by a different model.
- Maintains backward compatibility with ``adapter.py`` module-level functions
  (test patches control adapter attributes; this module accesses them through
  the module reference so patches still fire).
- Failed VLM analyses (exceptions AND the placeholder captions the call sites
  return on error) are SKIPPED rather than indexed, so placeholder text like
  "[Drawing - analysis failed]" never pollutes the vector store.
- The visual-page heuristic accepts pre-extracted page texts (the caller's
  watermark-stripped pdfplumber output) so the PDF's text layer is read once,
  and the documented "watermark-stripped text" threshold actually holds.

Typical usage (inside ``_run_ingestion``)::

    from knowledge_layer.ingest.processing import enrich_vlm_batch

    image_records = adapter._extract_images_from_pdf(file_path)
    drawing_pages = render_visual_pages_no_vlm(file_path, ..., page_texts=text_pages)

    image_results, drawing_pages = enrich_vlm_batch(
        image_records=image_records,
        drawing_pages=drawing_pages,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        extract_charts=extract_charts,
    )
    # image_results: list of (record, content_type, caption)
    # drawing_pages: list already enriched with caption/fields
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

from agent.common.cache import get_json
from agent.common.cache import set_json

from .pdfium_lock import detached_pil
from .pdfium_lock import pdfium_lock

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Content-hash cache TTL: 30 days. Long enough that re-ingesting a changed PDF
# (but with many unchanged images) still hits the cache for the stable images.
_VLM_CACHE_TTL_SECONDS = 30 * 86400


# ---------------------------------------------------------------------------
# Content-hash VLM cache
# ---------------------------------------------------------------------------


# Placeholder captions the adapter's VLM call sites return on failure
# (provider error, missing key, empty response). Compared case-insensitively.
_FAILURE_CAPTION_PREFIXES = ("[image -", "[drawing -", "[transcription -")


def is_failed_caption(caption: str | None) -> bool:
    """True when ``caption`` is a failure placeholder, not real VLM output.

    The VLM call sites are fail-open and return strings like
    ``"[Drawing - analysis failed: …]"`` instead of raising. Such placeholders
    must never be embedded into the vector store (they pollute retrieval with
    content-free chunks), so every ingestion path filters on this predicate.
    """
    return bool(caption) and caption.strip().lower().startswith(_FAILURE_CAPTION_PREFIXES)


def _result_carries_failed_caption(result: Any) -> bool:
    """True when a cached-call result carries a failure placeholder caption.

    The two VLM call shapes differ — ``(content_type, caption)`` for images,
    ``(caption, fields)`` for drawings — so every string member is checked
    rather than a fixed position.
    """
    if isinstance(result, str):
        return is_failed_caption(result)
    if isinstance(result, (list, tuple)):
        return any(isinstance(part, str) and is_failed_caption(part) for part in result)
    return False


def vlm_cache_key(image_bytes: bytes, prompt_type: str, model: str = "") -> str:
    """Content-hash cache key for a VLM analysis result.

    ``prompt_type`` distinguishes the prompt/mode that produced the result so a
    caption from one prompt is never served for another: ``"drawing"`` (the
    German drawing-aware prompt) versus ``"image:charts=<bool>"`` (the English
    image prompt, keyed by ``extract_charts`` since the chart-aware and
    descriptive variants yield different content_type/caption for the same bytes).

    ``model`` is part of the identity because different VLMs caption the same
    bytes differently — without it, a model switch (deployment-wide or per-org
    ``ingest_vlm`` override) would serve the old model's captions until TTL
    expiry, and two orgs on different models would share each other's output.
    """
    h = hashlib.sha256(image_bytes).hexdigest()
    return f"vlm:caption:{model}:{prompt_type}:{h}"


def _cached_vlm_call(
    image_bytes: bytes,
    prompt_type: str,
    live_call,
    *args,
    model: str = "",
    **kwargs,
):
    """Wrap a VLM call with content-hash caching.

    On cache hit: returns the stored JSON result directly.
    On cache miss: calls ``live_call(*args, **kwargs)``, stores, and returns.
    On read or store error: degrades to a live call (fail-open — a cache-backend
    hiccup must never block ingest nor masquerade as a VLM analysis failure).
    ``model`` scopes the cache entry to the VLM that produced it (see
    ``vlm_cache_key``).

    Failure placeholders are returned to the caller but never stored: a
    transient provider error would otherwise be cached for the full TTL, so the
    re-ingest that is supposed to recover the file would replay the failure
    from cache without ever calling the VLM again.
    """
    key = vlm_cache_key(image_bytes, prompt_type, model)
    from knowledge_layer.ingest import page_reads

    reads = page_reads.current()
    if reads is None:
        return _cached_or_live(key, live_call, args, kwargs)
    # One call per bytes and prompt for the file: the drawings read ahead of the
    # vision batch (`page_reads`) are the batch's own calls, not a second one.
    return reads.single_flight(
        key, lambda: _cached_or_live(key, live_call, args, kwargs), _result_carries_failed_caption
    )


def _cached_or_live(key: str, live_call, args: tuple, kwargs: dict):
    """The cached result under ``key``, else ``live_call``'s, stored unless it is a failure placeholder."""
    try:
        cached = get_json(key)
    except Exception:
        logger.debug("VLM cache read failed (swallowed) for %s", key[:60])
        cached = None
    if cached is not None:
        logger.debug("VLM cache HIT for %s", key[:60])
        return cached
    result = live_call(*args, **kwargs)
    if _result_carries_failed_caption(result):
        logger.debug("VLM analysis failed; not caching placeholder for %s", key[:60])
        return result
    try:
        set_json(key, result, _VLM_CACHE_TTL_SECONDS)
    except Exception:
        logger.debug("VLM cache write failed (swallowed) for %s", key[:60])
    return result


# ---------------------------------------------------------------------------
# Drawing-page renderer (VLM-free variant)
#
# Every PDFium call below runs under ``pdfium_lock`` (see that module): the
# ingest pool has more than one worker, and the ingest route renders preview
# thumbnails on its own thread. The lock covers one page's PDFium work at a
# time; JPEG encoding happens after it is released.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PageRead:
    """One page's outcome in ``render_visual_pages_no_vlm``."""

    image: Any = None
    capped: bool = False
    failed: bool = False
    #: ``(jpeg, width, height)`` of a page the file's page reads rendered already.
    jpeg: tuple[bytes, int, int] | None = None


def _pdfium_page_text(page: Any) -> str:
    text_page = page.get_textpage()
    try:
        return text_page.get_text_range() or ""
    finally:
        text_page.close()


def _is_drawing_page(page: Any, text: str, min_text_chars: int, min_paths: int) -> bool:
    """The standalone drawing check, through the same rule the ingestion triage uses."""
    from knowledge_layer.ingest import page_triage

    signals = page_triage._page_signals(page, 0, text, min_paths)
    kind = page_triage.classify_page(signals, min_text_chars=min_text_chars, min_paths=min_paths)
    return kind is page_triage.PageKind.DRAWING


def _render_page_image(page: Any, max_dim: int) -> Any:
    """Render one pdfium page so its longest edge is ``max_dim`` px, as an RGB PIL image. Hold the lock."""
    width_pt, height_pt = page.get_size()
    scale = max_dim / (max(width_pt, height_pt) or 1.0)
    return detached_pil(page.render(scale=scale)).convert("RGB")


def _encode_jpeg(pil_image: Any) -> tuple[bytes, int, int]:
    """``(jpeg, width, height)``. Pure PIL, so it runs outside the PDFium lock."""
    buf = io.BytesIO()
    pil_image.save(buf, format="JPEG", quality=90)
    return buf.getvalue(), pil_image.width, pil_image.height


def _open_pdf(pdf_path: str, purpose: str) -> Any:
    """The pdfium document, or None when it cannot be opened (logged). Takes the lock."""
    try:
        import pypdfium2 as pdfium

        with pdfium_lock():
            return pdfium.PdfDocument(pdf_path)
    except Exception as exc:  # noqa: BLE001 - the caller treats None as "nothing rendered"
        logger.warning("%s unavailable for %s (%s: %s)", purpose, pdf_path, type(exc).__name__, exc)
        return None


def _close_pdf(doc: Any) -> None:
    with pdfium_lock():
        doc.close()


def _render_numbered_page(doc: Any, number: int, max_dim: int, pdf_path: str) -> Any:
    """1-based page ``number`` rendered to a PIL image, or None (logged)."""
    with pdfium_lock():
        try:
            page = doc[number - 1]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Page %d of %s could not be opened for rendering (%s)", number, pdf_path, exc)
            return None
        try:
            return _render_page_image(page, max_dim)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Page %d of %s could not be rendered (%s)", number, pdf_path, exc)
            return None
        finally:
            page.close()


def render_pdf_pages(pdf_path: str, page_numbers: list[int], *, max_dim: int) -> dict[int, bytes]:
    """Render the given 1-based pages to JPEG; a page that fails is absent from the result.

    Safe from any thread: each page's PDFium work holds ``pdfium_lock``.
    """
    doc = _open_pdf(pdf_path, "Page render")
    if doc is None:
        return {}
    rendered: dict[int, bytes] = {}
    try:
        for number in page_numbers:
            image = _render_numbered_page(doc, number, max_dim, pdf_path)
            if image is not None:
                rendered[number] = _encode_jpeg(image)[0]
    finally:
        _close_pdf(doc)
    return rendered


def _page_is_visual(
    page: Any,
    page_num: int,
    only_pages: set[int] | None,
    page_texts: dict[int, str] | None,
    thresholds: tuple[int, int],
) -> bool:
    if only_pages is not None:
        return page_num + 1 in only_pages
    if page_texts is not None:
        raw_text = page_texts.get(page_num + 1) or ""
    else:
        raw_text = _pdfium_page_text(page)
    min_text_chars, min_paths = thresholds
    return _is_drawing_page(page, raw_text, min_text_chars, min_paths)


def _read_visual_page(doc: Any, page_num: int, *, can_render: bool, max_dim: int, criteria: dict) -> _PageRead:
    """Judge one page and render it when it is visual; all of it under the PDFium lock."""
    pdf_path = criteria["pdf_path"]
    rendered = criteria["prefetched"].get(page_num + 1)
    if rendered is not None and rendered["max_dim"] == max_dim and page_num + 1 in (criteria["only_pages"] or ()):
        jpeg = (rendered["image_bytes"], rendered["width"], rendered["height"])
        return _PageRead(jpeg=jpeg) if can_render else _PageRead(capped=True)
    with pdfium_lock():
        # Guarded separately, and this is the defect the guard exists for:
        # `doc[page_num]` raises on a damaged page and used to sit OUTSIDE the
        # render's guard, so one unreadable page abandoned every page after it.
        # A 40-page drawing set could lose 38 captions to page 2 and report
        # nothing — the caller sees a short list, not an error.
        try:
            page = doc[page_num]
        except Exception as e:  # noqa: BLE001
            logger.debug("Visual-page render skipped page %d of %s (%s)", page_num + 1, pdf_path, e)
            return _PageRead(failed=True)
        try:
            thresholds = (criteria["min_text_chars"], criteria["min_paths"])
            if not _page_is_visual(page, page_num, criteria["only_pages"], criteria["page_texts"], thresholds):
                return _PageRead()
            if not can_render:
                return _PageRead(capped=True)
            return _PageRead(image=_render_page_image(page, max_dim))
        except Exception as e:  # noqa: BLE001 - one page's render failing costs that page, not the rest
            logger.debug("Visual-page render failed on page %d of %s (%s)", page_num + 1, pdf_path, e)
            return _PageRead(failed=True)
        finally:
            page.close()


def _prefetched_renders() -> dict[int, dict[str, Any]]:
    from knowledge_layer.ingest import page_reads

    reads = page_reads.current()
    return reads.rendered() if reads is not None else {}


def render_visual_pages_no_vlm(
    pdf_path: str,
    max_dim: int = 2048,
    min_text_chars: int = 200,
    min_paths: int = 300,
    max_pages: int = 20,
    page_texts: dict[int, str] | None = None,
    only_pages: set[int] | None = None,
) -> list[dict[str, Any]]:
    """Detect and render drawing pages WITHOUT calling the VLM.

    Returns rendered JPEG bytes so the caller can batch VLM calls concurrently;
    a page the file's page reads rendered ahead (``page_reads``) is not rendered twice.

    ``page_texts`` (1-based page number → text) lets the caller hand in the
    text it already extracted — in ``_run_ingestion`` that is the
    watermark-stripped pdfplumber output, so the PDF's text layer is read once
    and the heuristic's documented "watermark-stripped text" threshold actually
    holds. When omitted, the text is read here via pdfium (raw, unstripped) —
    kept for standalone/test use.

    A page is a drawing by ``page_triage.classify_page``: many paths AND little
    text. Scanned and garbled pages are NOT drawings; they are transcribed
    (``transcription``). ``only_pages`` replaces the check with the caller's
    own triage — the ingestion path passes the pages it already classified, so
    the PDF is judged once.

    Returns a list of dicts:
      ``{"image_bytes": bytes, "page_number": int, "width": int, "height": int}``.
    Empty list when pypdfium2 is unavailable or the PDF has no visual pages.
    """
    # Opening is its own step: a PDF pdfium cannot parse is NOT a failed ingestion
    # (pdfplumber reads its text on a separate path), so it contributes no visual
    # pages. Logged at ERROR it filed a GitHub issue for every unusual PDF.
    doc = _open_pdf(pdf_path, "Visual-page rendering (text ingestion is unaffected)")
    if doc is None:
        return []

    criteria = {
        "pdf_path": pdf_path,
        "min_text_chars": min_text_chars,
        "min_paths": min_paths,
        "page_texts": page_texts,
        "only_pages": only_pages,
        "prefetched": _prefetched_renders(),
    }
    results: list[dict[str, Any]] = []
    skipped_pages = 0
    try:
        with pdfium_lock():
            page_count = len(doc)
        for page_num in range(page_count):
            read = _read_visual_page(
                doc, page_num, can_render=len(results) < max_pages, max_dim=max_dim, criteria=criteria
            )
            skipped_pages += read.failed
            if read.capped:
                # Said out loud rather than inferred from a short chunk list:
                # capped pages still index their text layer, but their drawings
                # are never described — a plan set whose later sheets show
                # sparse facts lost them here.
                logger.warning(
                    "Visual-page render cap (%d) reached for %s; remaining visual pages index as text only",
                    max_pages,
                    pdf_path,
                )
                break
            if read.image is None and read.jpeg is None:
                continue
            image_bytes, width, height = read.jpeg or _encode_jpeg(read.image)
            results.append({"image_bytes": image_bytes, "page_number": page_num + 1, "width": width, "height": height})
    except Exception as e:
        # Whatever is left: a failure of the document itself rather than of one
        # page. Still not fatal to ingestion, for the reason given above.
        logger.warning("Visual-page rendering stopped for %s (%s: %s)", pdf_path, type(e).__name__, e)
    finally:
        _close_pdf(doc)

    if results:
        logger.info("Detected %d visual page(s) in %s", len(results), pdf_path)
    if skipped_pages:
        # Said out loud rather than inferred from a short list: partial output that
        # looks complete is the failure mode this whole function had.
        logger.warning("Skipped %d unreadable page(s) while rendering %s", skipped_pages, pdf_path)

    return results


# ---------------------------------------------------------------------------
# Concurrent VLM batch enrichment
# ---------------------------------------------------------------------------


# @environment_variable VLM_SECOND_PASS_DELAY_SECONDS
# @category Knowledge Layer
# @type float
# @default 10
# @required false
# Seconds the vision batch waits before reading the pages and images that failed once more.
# A negative value turns the second pass off.
VLM_SECOND_PASS_DELAY_SECONDS = float(os.environ.get("VLM_SECOND_PASS_DELAY_SECONDS", "10"))


def enrich_vlm_batch(
    image_records: list[dict[str, Any]],
    drawing_pages: list[dict[str, Any]],
    vlm_model: str,
    vlm_base_url: str,
    vlm_api_key: str | None,
    extract_charts: bool = True,
):
    """Run ALL VLM calls for a file concurrently — embedded images AND rendered
    drawing pages — with content-hash caching, on the file's page-read pool
    (``page_reads``: shared with its transcriptions, streaming, no batch barrier).

    Returns ``(image_results, drawing_pages)``: ``(record, content_type, caption)``
    tuples in page and image order, and the input pages enriched with
    ``"caption"``, ``"fields"`` and ``"content_type"``, in page order. Items whose
    VLM analysis failed twice (exception OR placeholder caption) are omitted
    and logged: a failure placeholder is never indexed.
    """
    if not image_records and not drawing_pages:
        return [], []
    if not vlm_api_key:
        logger.warning("VLM not configured; skipping batch enrichment")
        return [], []
    vision = {
        "vlm_model": vlm_model,
        "vlm_base_url": vlm_base_url,
        "vlm_api_key": vlm_api_key,
        "extract_charts": extract_charts,
    }
    work: list[tuple[str, dict]] = [("image", record) for record in image_records]
    work += [("drawing", page) for page in drawing_pages]
    from knowledge_layer.ingest import page_reads

    with page_reads.pool_for_this_call() as reads:
        done, failed = _vision_pass(reads, work, vision)
        # One more pass for what failed, after a pause: a failed reply is never cached, so
        # this asks the model again. Most failures are passing (a timeout, a provider
        # hiccup the 429 waits do not cover), and a page dropped here is a page nobody
        # can search; a second pass costs only the pages that failed.
        if failed and VLM_SECOND_PASS_DELAY_SECONDS >= 0:
            logger.info("VLM batch: %d item(s) failed; trying them once more", len(failed))
            time.sleep(VLM_SECOND_PASS_DELAY_SECONDS)
            more, failed = _vision_pass(reads, failed, vision)
            done += more
    if failed:
        logger.warning("VLM batch: %d/%d item(s) failed twice and were skipped (not indexed)", len(failed), len(work))
    images = [result for kind, result in done if kind == "image"]
    images.sort(key=lambda item: (item[0].get("page_number") or 0, item[0].get("image_index") or 0))
    drawings = [result for kind, result in done if kind == "drawing"]
    drawings.sort(key=lambda page: page.get("page_number") or 0)
    return images, drawings


def _analyze_item(kind: str, obj: dict, vision: dict[str, Any]) -> Any:
    """One image or drawing through ``analyze_visual``: embedded rasters and rendered pages run the SAME analysis."""
    from knowledge_layer.ingest import adapter as _adapter

    content_type, caption, fields = _adapter.analyze_visual(obj["image_bytes"], **vision)
    obj["fields"] = fields
    if kind == "image":
        return (obj, content_type, caption)
    obj["caption"] = caption
    obj["content_type"] = content_type
    return obj


def _vision_pass(
    reads: Any, items: list[tuple[str, dict]], vision: dict[str, Any]
) -> tuple[list[tuple[str, Any]], list[tuple[str, dict]]]:
    """One streaming pass over ``items``: ``(kind, result)`` of those read, and the items that failed."""
    futures = [(kind, obj, reads.submit(_analyze_item, kind, obj, vision)) for kind, obj in items]
    done: list[tuple[str, Any]] = []
    failed: list[tuple[str, dict]] = []
    for kind, obj, future in futures:
        try:
            result = future.result()
        except Exception as e:  # noqa: BLE001 - one item's failure costs that item
            logger.warning("VLM enrichment failed for %s on page %s: %s", kind, obj.get("page_number"), e)
            failed.append((kind, obj))
            continue
        # Fail-open placeholder captions (provider error, empty response) carry no
        # retrievable content and would pollute the vector store as real chunks.
        caption = result[2] if kind == "image" else result.get("caption")
        if is_failed_caption(caption):
            logger.warning(
                "VLM analysis failed for %s on page %s: %s", kind, obj.get("page_number"), (caption or "")[:120]
            )
            failed.append((kind, obj))
            continue
        done.append((kind, result))
    return done, failed
