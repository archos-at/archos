import hashlib
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from . import limits
from .limits import MIN_IMAGE_HEIGHT_PX
from .limits import MIN_IMAGE_WIDTH_PX
from .limits import PAGE_RENDER_MAX_DIM
from .memory_use import _log_memory
from .pdfium_guard import close_bitmap
from .pdfium_guard import detached_pil
from .pdfium_guard import pdfium_lock

logger = logging.getLogger(__name__)

_PAGEOBJ_IMAGE = 3


@dataclass
class _RasterHarvest:
    records: list[dict[str, Any]] = field(default_factory=list)
    candidates: list[dict[str, Any]] = field(default_factory=list)
    seen_hashes: set[str] = field(default_factory=set)
    over_cap: int = 0
    over_pixel_budget: int = 0


@dataclass(frozen=True)
class _RasterLimits:
    min_width: int
    min_height: int
    skip_pages: set[int] | frozenset[int]
    max_images: int | None
    max_pixels: int


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
        max_pixels=limits.MAX_IMAGE_PIXELS,
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

    harvest = _RasterHarvest()
    bounds = _RasterLimits(min_width, min_height, skip_pages, max_images, max_pixels)
    try:
        _harvest_rasters(pdfium, pdf_path, harvest, bounds)
    except Exception as e:
        logger.error(f"Error extracting images from PDF: {e}")

    return harvest.records, harvest.over_cap, harvest.over_pixel_budget


def _harvest_rasters(pdfium: Any, pdf_path: str, harvest: _RasterHarvest, bounds: _RasterLimits) -> None:
    with pdfium_lock():
        doc = pdfium.PdfDocument(pdf_path)
        page_count = len(doc)
    try:
        _harvest_document(doc, page_count, pdf_path, harvest, bounds)
    finally:
        with pdfium_lock():
            doc.close()
    logger.info(
        "Extracted %d images from %s (%d candidates, %d over cap, %d over the pixel budget)",
        len(harvest.records),
        pdf_path,
        len(harvest.candidates),
        harvest.over_cap,
        harvest.over_pixel_budget,
    )


def _harvest_document(doc: Any, page_count: int, pdf_path: str, harvest: _RasterHarvest, bounds: _RasterLimits) -> None:
    for page_num in range(page_count):
        if page_num + 1 in bounds.skip_pages:
            continue
        page_candidates, page_over_budget = _image_candidates(
            doc, page_num, bounds.min_width, bounds.min_height, max_pixels=bounds.max_pixels, pdf_path=pdf_path
        )
        harvest.candidates.extend(page_candidates)
        harvest.over_pixel_budget += page_over_budget
    if bounds.max_images is None:
        kept = harvest.candidates
    else:
        kept, harvest.over_cap = cap_images(harvest.candidates, bounds.max_images)
    _log_memory(
        f"rasters:start kept={len(kept)} over_cap={harvest.over_cap} over_pixel_budget={harvest.over_pixel_budget}"
    )
    for page_number, page_candidates in _candidates_by_page(kept):
        harvest.records.extend(_decode_page_candidates(doc, page_number, page_candidates, harvest.seen_hashes))
    _log_memory(f"rasters:done kept={len(kept)}")


def _image_candidates(
    doc: Any, page_num: int, min_width: int, min_height: int, *, max_pixels: int, pdf_path: str
) -> tuple[list[dict[str, Any]], int]:
    with pdfium_lock():
        page = doc[page_num]
        try:
            return _sized_candidates(
                _image_objects(page), page_num, min_width, min_height, max_pixels=max_pixels, pdf_path=pdf_path
            )
        finally:
            page.close()


def _sized_candidates(
    objects: list[Any], page_num: int, min_width: int, min_height: int, *, max_pixels: int, pdf_path: str
) -> tuple[list[dict[str, Any]], int]:
    candidates: list[dict[str, Any]] = []
    over_budget = 0
    for img_idx, obj in enumerate(objects):
        size = _pixel_size_or_none(obj, img_idx, page_num)
        if size is None:
            continue
        width, height = size
        if width < min_width or height < min_height:
            continue
        if width * height > max_pixels:
            over_budget += 1
            _warn_over_pixel_budget(width, height, img_idx, page_num, pdf_path, max_pixels)
            continue
        candidates.append({"page_number": page_num + 1, "image_index": img_idx, "width": width, "height": height})
    return candidates, over_budget


def _pixel_size_or_none(obj: Any, img_idx: int, page_num: int) -> tuple[int, int] | None:
    try:
        return _image_pixel_size(obj)
    except Exception as e:
        logger.debug(f"Could not size image {img_idx} on page {page_num}: {e}")
        return None


def _warn_over_pixel_budget(
    width: int, height: int, img_idx: int, page_num: int, pdf_path: str, max_pixels: int
) -> None:
    logger.warning(
        "Refusing to decode %dx%d px (%d MP) image %d on page %d of %s: over the "
        "%d MP per-raster budget (MAX_IMAGE_PIXELS); the page's text is still indexed",
        width,
        height,
        (width * height) // 1_000_000,
        img_idx,
        page_num + 1,
        pdf_path,
        max_pixels // 1_000_000,
    )


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
    with pdfium_lock():
        page = doc[page_number - 1]
    try:
        with pdfium_lock():
            objects = _image_objects(page)
        return _decoded_records(objects, page_number, candidates, seen_hashes)
    finally:
        with pdfium_lock():
            page.close()


def _decoded_records(
    objects: list[Any], page_number: int, candidates: list[dict[str, Any]], seen_hashes: set[str]
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for candidate in candidates:
        image = _decoded_candidate(objects, candidate, page_number)
        if image is None:
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
    return records


def _decoded_candidate(objects: list[Any], candidate: dict[str, Any], page_number: int) -> Any:
    try:
        with pdfium_lock():
            return _downscaled_raster(objects[candidate["image_index"]])
    except Exception as e:
        logger.debug(f"Could not extract image {candidate['image_index']} from page {page_number}: {e}")
        return None


def _downscaled_raster(obj: Any) -> Any:
    bitmap = obj.get_bitmap()
    try:
        image = bitmap.to_pil()
        size = image.size
        image.thumbnail((limits.VLM_MAX_IMAGE_DIM, limits.VLM_MAX_IMAGE_DIM))
        if image.size == size:
            image = image.copy()
        return image
    finally:
        close_bitmap(bitmap)


def _raster_record(
    pil_image: Any, page_number: int, img_idx: int, size: tuple[int, int], seen_hashes: set[str]
) -> dict[str, Any] | None:
    import io

    pil_image.thumbnail((limits.VLM_MAX_IMAGE_DIM, limits.VLM_MAX_IMAGE_DIM))
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
            return _render_page_zero(pdf, scale=scale, max_dim=max_dim)
        finally:
            pdf.close()


def _render_page_zero(pdf: Any, *, scale: float, max_dim: int) -> Any:
    page = pdf[0]
    try:
        width_pt, height_pt = page.get_size()
        longest_pt = max(width_pt, height_pt) or 1.0
        render_scale = min(scale, max_dim / longest_pt)
        return detached_pil(page.render(scale=render_scale))
    finally:
        page.close()


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
        max_images=limits.MAX_IMAGES_PER_DOCUMENT,
        max_pixels=limits.MAX_IMAGE_PIXELS,
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
            limits.MAX_IMAGE_PIXELS // 1_000_000,
        )
    return images, over_cap, over_pixel_budget
