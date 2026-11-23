import io
import math
from typing import Any

from knowledge_layer.ingest import detached_pil
from knowledge_layer.ingest import pdfium_lock

from .view_regions import _MIN_REGION_PX
from .view_regions import Region
from .view_regions import _grown
from .view_regions import region_box_pt
from .view_regions import region_render_args

_JPEG_QUALITY = 90


def _render_pdf_page(source: str | bytes, page_number: int, max_dim: int) -> tuple[bytes, int, int]:
    import pypdfium2 as pdfium

    with pdfium_lock():
        doc = pdfium.PdfDocument(source)
        try:
            pil_image = _render_whole_page(doc, page_number, max_dim)
        finally:
            doc.close()

    rgb = pil_image.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=_JPEG_QUALITY)
    return buf.getvalue(), rgb.width, rgb.height


def _render_whole_page(doc: Any, page_number: int, max_dim: int) -> Any:
    page = doc[page_number - 1]
    try:
        width_pt, height_pt = page.get_size()
        longest_pt = max(width_pt, height_pt) or 1.0
        return detached_pil(page.render(scale=max_dim / longest_pt))
    finally:
        page.close()


def _render_page(pdf_path: str, page_number: int, max_dim: int) -> tuple[bytes, int, int]:
    return _render_pdf_page(pdf_path, page_number, max_dim)


def _render_page_from_bytes(pdf_bytes: bytes, page_number: int, max_dim: int) -> tuple[bytes, int, int]:
    return _render_pdf_page(pdf_bytes, page_number, max_dim)


def _normalize_image_to_jpeg(image_bytes: bytes, max_dim: int) -> tuple[bytes, int, int]:
    from PIL import Image

    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    longest = max(pil_image.width, pil_image.height) or 1
    if longest > max_dim:
        scale = max_dim / longest
        pil_image = pil_image.resize((max(1, round(pil_image.width * scale)), max(1, round(pil_image.height * scale))))
    buf = io.BytesIO()
    pil_image.save(buf, format="JPEG", quality=_JPEG_QUALITY)
    return buf.getvalue(), pil_image.width, pil_image.height


def _render_pdf_region(
    source: str | bytes, page_number: int, region: Region, max_dim: int
) -> tuple[bytes, int, int, bool]:
    import pypdfium2 as pdfium

    with pdfium_lock():
        doc = pdfium.PdfDocument(source)
        try:
            pil_image, width_pt, height_pt = _render_page_region(
                doc, page_number, region, max_dim, pdfium.PdfBitmap.new_native
            )
        finally:
            doc.close()
    widened = region_box_pt(region, width_pt, height_pt)[2:] != (region[2] * width_pt, region[3] * height_pt)
    rgb = pil_image.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=_JPEG_QUALITY)
    return buf.getvalue(), rgb.width, rgb.height, widened


def _render_page_region(
    doc: Any, page_number: int, region: Region, max_dim: int, bitmap_maker: Any
) -> tuple[Any, float, float]:
    page = doc[page_number - 1]
    try:
        width_pt, height_pt = page.get_size()
        scale, crop = region_render_args(region, width_pt, height_pt, max_dim)
        bitmap = page.render(scale=scale, crop=crop, bitmap_maker=bitmap_maker)
        return detached_pil(bitmap), width_pt, height_pt
    finally:
        page.close()


def _crop_image_region(image_bytes: bytes, region: Region, max_dim: int) -> tuple[bytes, int, int, bool]:
    from PIL import Image

    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    x0, w0 = _grown(region[0] * pil_image.width, region[2] * pil_image.width, _MIN_REGION_PX, pil_image.width)
    y0, h0 = _grown(region[1] * pil_image.height, region[3] * pil_image.height, _MIN_REGION_PX, pil_image.height)
    widened = (w0, h0) != (region[2] * pil_image.width, region[3] * pil_image.height)
    box = (math.floor(x0), math.floor(y0), math.ceil(x0 + w0), math.ceil(y0 + h0))
    cropped = pil_image.crop(box)
    longest = max(cropped.width, cropped.height) or 1
    if longest > max_dim:
        scale = max_dim / longest
        cropped = cropped.resize((max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))))
    buf = io.BytesIO()
    cropped.save(buf, format="JPEG", quality=_JPEG_QUALITY)
    return buf.getvalue(), cropped.width, cropped.height, widened
