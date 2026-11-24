from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from PIL import Image

_LOCK = threading.RLock()
_WAITING = [0]
_COUNTING = threading.Lock()
HAND_OVER_S = 0.002


def _waiting(change: int) -> None:
    with _COUNTING:
        _WAITING[0] += change


@contextmanager
def pdfium_lock() -> Iterator[None]:
    _waiting(1)
    try:
        _LOCK.acquire()
    finally:
        _waiting(-1)
    try:
        yield
    finally:
        _LOCK.release()


def pdfium_pause() -> None:
    if not _WAITING[0]:
        return
    _LOCK.release()
    try:
        time.sleep(HAND_OVER_S)
    finally:
        _LOCK.acquire()


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
