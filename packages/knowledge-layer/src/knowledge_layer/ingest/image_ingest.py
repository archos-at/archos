from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from agent.knowledge.schema import FileStatus

from .coverage import image_coverage

logger = logging.getLogger(__name__)

IMAGE_UNREAD_ERROR = "Image could not be decoded or captioned (corrupted file or VLM failure)"


@dataclass
class ImageRead:
    documents: list[Any] | None
    photo: Any = None
    coverage: dict[str, Any] | None = None


def _screen_reading(ingestor: Any, job: Any, index: int, rules: Any, documents: list[Any]) -> bool:
    text = "\n\n".join(str(getattr(document, "text", "") or "") for document in documents)
    pages = [(1, text)]
    return ingestor._screen_or_quarantine(job, index, rules, pages, "partial", stream=pages, after_transcription=True)


def read_standalone_image(
    ingestor: Any,
    job: Any,
    index: int,
    *,
    file_path: str,
    file_name: str,
    file_size: int,
    image_format: str,
    rules: Any,
    thumbnail_upload_url: str | None,
    vision: dict[str, Any],
    stages: dict[str, float],
) -> ImageRead:
    from knowledge_layer.ingest import adapter as _adapter
    from knowledge_layer.ingest.photo_facts import read_photo_facts

    if not vision.get("vlm_api_key"):
        ingestor._record_screening(job, index, rules, "unchecked")
        ingestor._thumbnail_after_screen(thumbnail_upload_url, file_path)
        error = "vlm_not_configured: image ingestion requires VLM_API_KEY"
        ingestor._update_file_status(job, index, FileStatus.FAILED, error=error)
        logger.warning("Image ingestion skipped (VLM not configured): %s", file_name)
        return ImageRead(None)
    photo = read_photo_facts(file_path)
    with _adapter._stage(stages, "vision"):
        documents = _adapter._build_image_documents(
            file_path, file_name, file_size, image_format, photo=photo, **vision
        )
    if documents is None:
        ingestor._record_screening(job, index, rules, "unchecked")
        ingestor._update_file_status(job, index, FileStatus.FAILED, error=IMAGE_UNREAD_ERROR)
        logger.warning("Image could not be decoded or captioned: %s", file_name)
        return ImageRead(None, photo, image_coverage(read=False))
    with _adapter._stage(stages, "screen"):
        held = _screen_reading(ingestor, job, index, rules, documents)
    if held:
        return ImageRead(None, photo, image_coverage(read=True))
    ingestor._thumbnail_after_screen(thumbnail_upload_url, file_path)
    return ImageRead(documents, photo, image_coverage(read=True))


_FORMAT_BY_SUFFIX = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}


def standalone_image_format(file_path: str, file_name: str) -> str | None:
    from pathlib import Path

    from .adapter import _looks_like_image

    return _looks_like_image(file_path) or _FORMAT_BY_SUFFIX.get(Path(file_name).suffix.lower())
