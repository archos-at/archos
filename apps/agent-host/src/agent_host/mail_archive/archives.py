from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .reader import Archive
from .reader import open_archive
from .remote_file import RangeFile

MAX_OPEN = 2
IDLE_SECONDS = 300
JANITOR_SECONDS = 60

_CLIENT = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0), trust_env=False)


@dataclass
class _Open:
    archive: Archive
    file: RangeFile
    size: int
    used_at: float
    holders: int = 0
    evicted: bool = False


_open: OrderedDict[str, _Open] = OrderedDict()
_lock = threading.Lock()
_janitor: threading.Thread | None = None


def object_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{parts.path}"


@contextmanager
def use_archive(url: str, size: int) -> Iterator[Archive]:
    entry = _acquire(object_of(url), url, size)
    try:
        with entry.archive.lock:
            entry.file.clear_error()
            yield entry.archive
    finally:
        _release(entry)


def reset_open_archives() -> None:
    with _lock:
        entries = list(_open.values())
        _open.clear()
    for entry in entries:
        entry.archive.close()


def _acquire(key: str, url: str, size: int) -> _Open:
    cached = _hold_cached(key, size)
    if cached is not None:
        return _proven(cached, url)
    remote = RangeFile(url, size, _CLIENT)
    opened = _Open(archive=open_archive(remote), file=remote, size=size, used_at=time.monotonic(), holders=1)
    with _lock:
        raced = _open.get(key)
        if raced is not None and raced.size == size:
            raced.holders += 1
            dropped, entry = opened, raced
        else:
            dropped, entry = None, opened
            _open[key] = opened
        closable = _evict_over_capacity()
        if raced is not None and raced.size != size:
            _retire(raced, closable)
    _ensure_janitor()
    if dropped is not None:
        dropped.archive.close()
    for stale in closable:
        stale.archive.close()
    return entry


def _retire(stale: _Open, closable: list[_Open]) -> None:
    stale.evicted = True
    if not stale.holders:
        closable.append(stale)


def _hold_cached(key: str, size: int) -> _Open | None:
    with _lock:
        entry = _open.get(key)
        if entry is None or entry.size != size:
            return None
        entry.holders += 1
        _open.move_to_end(key)
        return entry


def _proven(entry: _Open, url: str) -> _Open:
    try:
        entry.file.prove(url)
    except BaseException:
        _release(entry)
        raise
    entry.file.renew(url)
    return entry


def _release(entry: _Open) -> None:
    with _lock:
        entry.holders -= 1
        entry.used_at = time.monotonic()
        close = entry.evicted and entry.holders == 0
    if close:
        entry.archive.close()


def _evict_over_capacity() -> list[_Open]:
    closable: list[_Open] = []
    for key in list(_open):
        if len(_open) <= MAX_OPEN:
            break
        entry = _open[key]
        if entry.holders:
            continue
        del _open[key]
        closable.append(entry)
    return closable


def _close_idle(now: float) -> None:
    with _lock:
        idle = [key for key, entry in _open.items() if not entry.holders and now - entry.used_at > IDLE_SECONDS]
        entries = [_open.pop(key) for key in idle]
    for entry in entries:
        entry.archive.close()


def _ensure_janitor() -> None:
    global _janitor
    with _lock:
        if _janitor is not None and _janitor.is_alive():
            return
        _janitor = threading.Thread(target=_sweep_forever, name="mail-archive-janitor", daemon=True)
        _janitor.start()


def _sweep_forever() -> None:
    while True:
        time.sleep(JANITOR_SECONDS)
        _close_idle(time.monotonic())
