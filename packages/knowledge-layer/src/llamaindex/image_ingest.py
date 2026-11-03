"""A standalone uploaded image, from its bytes to its Documents: read, screened, then its thumbnail.

An image has no text layer, so nothing of it can be screened before a model
sees it, and for a long time it was not screened at all: every image ended
``screening=unchecked`` (320 in fourteen days). Its only content is what the
vision model read off it, so that text is screened once it exists, exactly as a
scanned PDF's transcription is (``_screen_transcribed``): ``partial`` when it is
clean (there was nothing to screen before the model call), ``quarantined`` on a
match, with the verdict saying the model saw it (``after_transcription``). The
thumbnail is drawn only after that verdict (ADR-0086).

The read's outcome is the image's coverage record (``coverage.image_coverage``),
so an image the model could not read is a page ``not_read`` for
``vision_failed``, on the trace and the job's status, and not only a failed file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from agent.knowledge.schema import FileStatus

from ..coverage import image_coverage

logger = logging.getLogger(__name__)

#: The failure of an image the model could not read. Its wording is matched by the failure classifier.
IMAGE_UNREAD_ERROR = "Image could not be decoded or captioned (corrupted file or VLM failure)"


@dataclass
class ImageRead:
    """What reading one image left: its Documents (``None`` when the file stops), its photo facts, its coverage."""

    documents: list[Any] | None
    photo: Any = None
    coverage: dict[str, Any] | None = None


def _screen_reading(ingestor: Any, job: Any, index: int, rules: Any, documents: list[Any]) -> bool:
    """Screen what the vision model read off the image; True when the file was quarantined."""
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
    """Read one image with the vision model, screen the reading, then draw its thumbnail.

    ``vision`` holds ``vlm_model``, ``vlm_base_url``, ``vlm_api_key`` and
    ``extract_charts``. A file that stops (no vision key, unreadable, quarantined)
    has its status written here and returns no Documents.
    """
    from knowledge_layer.llamaindex import adapter as _adapter
    from knowledge_layer.llamaindex.photo_facts import read_photo_facts

    if not vision.get("vlm_api_key"):
        # Nothing of it is read, so nothing is screened: it passes on its name.
        ingestor._record_screening(job, index, rules, "unchecked")
        ingestor._thumbnail_after_screen(thumbnail_upload_url, file_path)
        error = "vlm_not_configured: image ingestion requires VLM_API_KEY"
        ingestor._update_file_status(job, index, FileStatus.FAILED, error=error)
        logger.warning("Image ingestion skipped (VLM not configured): %s", file_name)
        return ImageRead(None)
    # From the ORIGINAL bytes: the re-encode for the model drops EXIF.
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
