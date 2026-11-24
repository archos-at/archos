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

from .pdfium_guard import detached_pil
from .pdfium_guard import pdfium_lock

logger = logging.getLogger(__name__)


_VLM_CACHE_TTL_SECONDS = 30 * 86400


_FAILURE_CAPTION_PREFIXES = ("[image -", "[drawing -", "[transcription -")


def is_failed_caption(caption: str | None) -> bool:
    return bool(caption) and caption.strip().lower().startswith(_FAILURE_CAPTION_PREFIXES)


def _result_carries_failed_caption(result: Any) -> bool:
    if isinstance(result, str):
        return is_failed_caption(result)
    if isinstance(result, (list, tuple)):
        return any(isinstance(part, str) and is_failed_caption(part) for part in result)
    return False


def vlm_cache_key(image_bytes: bytes, prompt_type: str, model: str = "") -> str:
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
    key = vlm_cache_key(image_bytes, prompt_type, model)
    from knowledge_layer.ingest import page_reads

    reads = page_reads.current()
    if reads is None:
        return _cached_or_live(key, live_call, args, kwargs)
    return reads.single_flight(
        key, lambda: _cached_or_live(key, live_call, args, kwargs), _result_carries_failed_caption
    )


def _cached_or_live(key: str, live_call, args: tuple, kwargs: dict):
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


@dataclass(frozen=True)
class _PageRead:
    image: Any = None
    capped: bool = False
    failed: bool = False
    jpeg: tuple[bytes, int, int] | None = None


def _pdfium_page_text(page: Any) -> str:
    text_page = page.get_textpage()
    try:
        return text_page.get_text_range() or ""
    finally:
        text_page.close()


def _is_drawing_page(page: Any, text: str, min_text_chars: int, min_paths: int) -> bool:
    from knowledge_layer.ingest import page_triage

    signals = page_triage._page_signals(page, 0, text, min_paths)
    kind = page_triage.classify_page(signals, min_text_chars=min_text_chars, min_paths=min_paths)
    return kind is page_triage.PageKind.DRAWING


def _render_page_image(page: Any, max_dim: int) -> Any:
    width_pt, height_pt = page.get_size()
    scale = max_dim / (max(width_pt, height_pt) or 1.0)
    return detached_pil(page.render(scale=scale)).convert("RGB")


def _encode_jpeg(pil_image: Any) -> tuple[bytes, int, int]:
    buf = io.BytesIO()
    pil_image.save(buf, format="JPEG", quality=90)
    return buf.getvalue(), pil_image.width, pil_image.height


def _open_pdf(pdf_path: str, purpose: str) -> Any:
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
    pdf_path = criteria["pdf_path"]
    rendered = criteria["prefetched"].get(page_num + 1)
    if rendered is not None and rendered["max_dim"] == max_dim and page_num + 1 in (criteria["only_pages"] or ()):
        jpeg = (rendered["image_bytes"], rendered["width"], rendered["height"])
        return _PageRead(jpeg=jpeg) if can_render else _PageRead(capped=True)
    with pdfium_lock():
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
        logger.warning("Visual-page rendering stopped for %s (%s: %s)", pdf_path, type(e).__name__, e)
    finally:
        _close_pdf(doc)

    if results:
        logger.info("Detected %d visual page(s) in %s", len(results), pdf_path)
    if skipped_pages:
        logger.warning("Skipped %d unreadable page(s) while rendering %s", skipped_pages, pdf_path)

    return results


VLM_SECOND_PASS_DELAY_SECONDS = float(os.environ.get("VLM_SECOND_PASS_DELAY_SECONDS", "10"))


def enrich_vlm_batch(
    image_records: list[dict[str, Any]],
    drawing_pages: list[dict[str, Any]],
    vlm_model: str,
    vlm_base_url: str,
    vlm_api_key: str | None,
    extract_charts: bool = True,
):
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
    from knowledge_layer.ingest import vision_reads

    content_type, caption, fields = vision_reads.analyze_visual(obj["image_bytes"], **vision)
    obj["fields"] = fields
    if kind == "image":
        return (obj, content_type, caption)
    obj["caption"] = caption
    obj["content_type"] = content_type
    return obj


def _vision_pass(
    reads: Any, items: list[tuple[str, dict]], vision: dict[str, Any]
) -> tuple[list[tuple[str, Any]], list[tuple[str, dict]]]:
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
        caption = result[2] if kind == "image" else result.get("caption")
        if is_failed_caption(caption):
            logger.warning(
                "VLM analysis failed for %s on page %s: %s", kind, obj.get("page_number"), (caption or "")[:120]
            )
            failed.append((kind, obj))
            continue
        done.append((kind, result))
    return done, failed
