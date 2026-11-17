from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from PIL import Image

_LOCK = threading.RLock()


@contextmanager
def pdfium_lock() -> Iterator[None]:
    with _LOCK:
        yield


def close_bitmap(bitmap: Any) -> None:
    close = getattr(bitmap, "close", None)
    if close is None:
        return
    if hasattr(bitmap, "warn_on_close"):
        bitmap.warn_on_close = False
    close()


def detached_pil(bitmap: Any) -> Image.Image:
    try:
        return bitmap.to_pil().copy()
    finally:
        close_bitmap(bitmap)
