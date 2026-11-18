from __future__ import annotations

import logging
from typing import Any
from typing import NamedTuple

logger = logging.getLogger(__name__)


class VisualDocuments(NamedTuple):
    documents: list[Any]
    charts: int
    images: int


def _raster_metadata(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "image_index": record["image_index"],
        "image_format": record["format"],
        "image_width": record["width"],
        "image_height": record["height"],
        **{key: record[key] for key in ("image_key", "stored_image_index") if key in record},
    }


def visual_documents_for_pdf(
    image_results: list[tuple[dict[str, Any], str, str]],
    drawing_pages: list[dict[str, Any]],
    *,
    file_name: str,
    file_size: int,
    extract_images: bool,
    extract_charts: bool,
) -> VisualDocuments:
    from knowledge_layer.ingest import caption_documents

    documents: list[Any] = []
    charts = images = 0
    for record, content_type, caption in image_results:
        caption = caption_documents._scrub_watermark_phrases(caption) or "[Image - no describable content]"
        content_type = caption_documents.indexed_visual_type(
            content_type, extract_images=extract_images, extract_charts=extract_charts
        )
        if content_type is None:
            continue
        documents.extend(
            caption_documents.visual_documents(
                content_type,
                caption,
                record.get("fields") or {},
                file_name=file_name,
                file_size=file_size,
                page_number=record["page_number"],
                extra_metadata=_raster_metadata(record),
            )
        )
        if content_type == "chart":
            charts += 1
        else:
            images += 1
    if charts or images:
        logger.info(f"  Visual extraction: {charts} charts, {images} images")
    for page in drawing_pages:
        documents.extend(
            caption_documents.visual_documents(
                page.get("content_type") or "drawing",
                page.get("caption", ""),
                page.get("fields") or {},
                file_name=file_name,
                file_size=file_size,
                page_number=page["page_number"],
                extra_metadata={"image_width": page.get("width", 0), "image_height": page.get("height", 0)},
            )
        )
    if drawing_pages:
        logger.info(f"  Drawing extraction: {len(drawing_pages)} rendered page(s)")
    return VisualDocuments(documents, charts, images + len(drawing_pages))
