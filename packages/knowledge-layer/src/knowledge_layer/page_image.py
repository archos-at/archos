from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from . import view_image as _view
from . import view_rendering as _rendering

logger = logging.getLogger(__name__)


class PageImageUnavailable(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class PageImage:
    jpeg: bytes
    width: int
    height: int


async def load_page_jpeg(
    collection: str,
    file_name: str,
    page: int,
    *,
    organization_id: str | None = None,
    max_dim: int | None = None,
    timeout: float = 30.0,
) -> PageImage:
    if page < 1:
        raise PageImageUnavailable("invalid_page")
    limit = max_dim or _view.default_max_dim()
    location = await _view._resolve_storage_location(collection, file_name, organization_id)
    if location is None:
        raise PageImageUnavailable("not_stored")
    try:
        data = await asyncio.wait_for(asyncio.to_thread(_view._fetch_seaweed_bytes, *location), timeout=timeout)
    except Exception:  # noqa: BLE001 - every failure is the same answer to the caller
        logger.warning("page_image: fetch failed for %s/%s", collection, file_name, exc_info=True)
        data = None
    if data is None:
        raise PageImageUnavailable("fetch_failed")

    standalone = _view._is_standalone_image(file_name)
    if standalone and page != 1:
        raise PageImageUnavailable("page_not_found")
    render = _rendering._normalize_image_to_jpeg if standalone else _rendering._render_page_from_bytes
    arguments = (data, limit) if standalone else (data, page, limit)
    try:
        jpeg, width, height = await asyncio.wait_for(asyncio.to_thread(render, *arguments), timeout=timeout)
    except Exception:  # noqa: BLE001 - a page past the end, a damaged file and a non-PDF alike
        logger.warning("page_image: render failed for %s/%s page %d", collection, file_name, page, exc_info=True)
        raise PageImageUnavailable("page_not_found") from None
    return PageImage(jpeg=jpeg, width=width, height=height)
