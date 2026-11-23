from __future__ import annotations

from collections.abc import Collection
from collections.abc import Sequence
from typing import Any

REASONS = ("render_cap", "vision_failed", "transcription_failed", "transcription_cap", "no_vision")


def reading_coverage(
    *,
    page_count: int,
    text_pages: Sequence[dict[str, Any]],
    drawing_pages: Collection[int] | None,
    rendered: int,
    read: int,
    transcribed: int,
    transcription_failed: int,
    transcription_over_cap: int,
    not_transcribed: int,
    vision_configured: bool,
) -> dict[str, Any] | None:
    if page_count <= 0:
        return None
    drawings = len(drawing_pages) if drawing_pages is not None else rendered
    reasons = {
        "render_cap": max(0, drawings - rendered) if vision_configured else 0,
        "vision_failed": max(0, rendered - read),
        "transcription_failed": transcription_failed,
        "transcription_cap": transcription_over_cap,
        "no_vision": not_transcribed + (drawings if not vision_configured else 0),
    }
    reasons = {key: count for key, count in reasons.items() if count > 0}
    with_text = sum(1 for page in text_pages if str(page.get("text") or "").strip())
    return {
        "pages": page_count,
        "text": max(0, with_text - transcribed),
        "transcribed": transcribed,
        "drawings": drawings,
        "drawings_read": read,
        "not_read": min(page_count, sum(reasons.values())),
        "reasons": reasons,
    }


def image_coverage(*, read: bool) -> dict[str, Any]:
    return {
        "pages": 1,
        "text": 0,
        "transcribed": 0,
        "drawings": 1,
        "drawings_read": 1 if read else 0,
        "not_read": 0 if read else 1,
        "reasons": {} if read else {"vision_failed": 1},
    }
