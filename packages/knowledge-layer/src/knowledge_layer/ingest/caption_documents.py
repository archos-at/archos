import logging
import re
from typing import Any

from . import limits
from . import vision_reads
from .pdf_text import _WATERMARK_PHRASES
from .vision_credentials import DEFAULT_VLM_BASE_URL
from .vision_credentials import DEFAULT_VLM_MODEL

logger = logging.getLogger(__name__)

WATERMARK_PHRASE_PATTERNS = [re.compile(fragment, re.IGNORECASE) for fragment, _suffix in _WATERMARK_PHRASES]

_VISUAL_PREFIXES = {"drawing": "DRAWING", "chart": "CHART", "image": "IMAGE"}
_VISUAL_MARKER = re.compile(r"^\[(?:DRAWING|CHART|IMAGE) from page \d+\]\s*")


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


def indexed_visual_type(content_type: str, *, extract_images: bool, extract_charts: bool) -> str | None:
    if content_type == "chart":
        if extract_charts:
            return "chart"
        return "image" if extract_images else None
    return content_type if extract_images else None


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
            rgb_image.thumbnail((limits.VLM_MAX_IMAGE_DIM, limits.VLM_MAX_IMAGE_DIM))
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
        vision_reads._analyze_image_with_vlm,
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

    from knowledge_layer.ingest import visual_rendering

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
            for payload in visual_rendering.segment_payloads(analysis)
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

    content_type, caption, fields = vision_reads.analyze_visual(
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
