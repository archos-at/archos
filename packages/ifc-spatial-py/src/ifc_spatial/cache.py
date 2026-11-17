from __future__ import annotations

import atexit
import hashlib
import os
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

from .model import SpatialModel

_TEMP_FILES: list[dict[str, str]] = []


@atexit.register
def _remove_spilled_files() -> None:
    for table in _TEMP_FILES:
        for path in table.values():
            try:
                os.unlink(path)
            except OSError:
                pass


_CHUNK = 1 << 20


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_file(path: str | os.PathLike[str]) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


class _Pending:
    __slots__ = ("done", "model", "error")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.model: SpatialModel | None = None
        self.error: BaseException | None = None


class SpatialCache:
    def __init__(self, max_entries: int = 4) -> None:
        self._models: OrderedDict[str, SpatialModel] = OrderedDict()
        self._in_flight: dict[str, _Pending] = {}
        self._lock = threading.Lock()
        self._max_entries = max(1, max_entries)
        self._hits = 0
        self._misses = 0
        self._temp: dict[str, str] = {}
        _TEMP_FILES.append(self._temp)

    @property
    def stats(self) -> dict[str, int]:
        return {"hits": self._hits, "misses": self._misses, "entries": len(self._models)}

    def has(self, content_hash: str) -> bool:
        with self._lock:
            return content_hash in self._models

    def get(self, content_hash: str) -> SpatialModel | None:
        with self._lock:
            model = self._models.get(content_hash)
            if model is None:
                self._misses += 1
                return None
            self._models.move_to_end(content_hash)
            self._hits += 1
            return model

    def resolve(self, prefix: str) -> SpatialModel | None:
        key = prefix.strip().lower()
        with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                return self._models[key]
            matches = [h for h in self._models if h.startswith(key)] if len(key) >= 8 else []
        if len(matches) == 1:
            return self.get(matches[0])
        return None

    def hashes(self) -> list[str]:
        with self._lock:
            return list(self._models)

    def load(self, path: str | os.PathLike[str]) -> SpatialModel:
        return self._load(hash_file(path), str(path), None)

    def load_bytes(self, data: bytes, *, suffix: str = ".ifc") -> SpatialModel:
        content = hash_bytes(data)
        with self._lock:
            existing = self._models.get(content)
            if existing is not None:
                self._models.move_to_end(content)
                self._hits += 1
                return existing
            path = self._temp.get(content)
        if path is None:
            handle, path = tempfile.mkstemp(prefix=f"ifc-spatial-{content[:12]}-", suffix=suffix)
            with os.fdopen(handle, "wb") as file:
                file.write(data)
            with self._lock:
                self._temp[content] = path
        return self._load(content, path, data)

    def _load(self, content: str, path: str, data: bytes | None) -> SpatialModel:
        with self._lock:
            resident = self._models.get(content)
            if resident is not None:
                self._models.move_to_end(content)
                self._hits += 1
                return resident
            running = self._in_flight.get(content)
            if running is not None:
                self._hits += 1
                pending = running
            else:
                self._misses += 1
                pending = _Pending()
                self._in_flight[content] = pending
                running = None

        if running is not None:
            pending.done.wait()
            if pending.error is not None:
                raise pending.error
            assert pending.model is not None
            return pending.model

        try:
            model = SpatialModel(path)
        except BaseException as error:  # noqa: BLE001 — re-raised to every waiter
            pending.error = error
            with self._lock:
                self._in_flight.pop(content, None)
            pending.done.set()
            raise
        else:
            pending.model = model
            with self._lock:
                self._models[content] = model
                self._models.move_to_end(content)
                self._evict(keep=content)
                self._in_flight.pop(content, None)
            pending.done.set()
            return model

    def _evict(self, keep: str) -> None:
        while len(self._models) > self._max_entries:
            oldest = next(iter(self._models))
            if oldest == keep:
                break
            self._models.pop(oldest, None)

    def clear(self) -> None:
        with self._lock:
            self._models.clear()


__all__ = ["SpatialCache", "hash_bytes", "hash_file"]
