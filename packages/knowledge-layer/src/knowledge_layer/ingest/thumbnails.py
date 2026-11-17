import logging
from typing import Any

from agent.common.connect_retry import connect_retrying_client

from .file_sniffing import _looks_like_image
from .file_sniffing import _looks_like_pdf
from .pdf_rasters import _render_first_pdf_page

logger = logging.getLogger(__name__)

THUMBNAIL_MAX_DIM = 400


def _opened_image(file_path: str) -> Any:
    from PIL import Image
    from PIL import ImageOps

    try:
        pil_image = Image.open(file_path)
        pil_image.load()
        pil_image = ImageOps.exif_transpose(pil_image)
        return pil_image if pil_image.mode == "RGB" else pil_image.convert("RGB")
    except Exception:
        logger.warning("Failed to open image for thumbnail", exc_info=True)
        return None


def _rendered_pdf(file_path: str) -> Any:
    try:
        return _render_first_pdf_page(file_path, scale=2)
    except Exception:
        logger.warning("Failed to render PDF page for thumbnail", exc_info=True)
        return None


def _thumbnail_source(file_path: str) -> Any:
    if _looks_like_pdf(file_path):
        return _rendered_pdf(file_path)
    if _looks_like_image(file_path) is not None:
        return _opened_image(file_path)
    return None


def _upload_thumbnail(thumbnail_upload_url: str, thumbnail_bytes: bytes) -> None:
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


class Thumbnails:
    def _thumbnail_after_screen(self, thumbnail_upload_url: str | None, image_path: str | None) -> None:
        if thumbnail_upload_url and image_path:
            self._generate_and_upload_thumbnail(image_path, thumbnail_upload_url)

    @staticmethod
    def _generate_and_upload_thumbnail(
        file_path: str,
        thumbnail_upload_url: str,
    ) -> None:
        import io

        pil_image = _thumbnail_source(file_path)
        if pil_image is None:
            return

        pil_image.thumbnail((THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM))
        buf = io.BytesIO()
        pil_image.save(buf, format="JPEG", quality=80)
        _upload_thumbnail(thumbnail_upload_url, buf.getvalue())
