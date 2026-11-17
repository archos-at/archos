import threading
from collections.abc import Callable

from knowledge_layer.env import env_int

EMBED_CACHE_MAX = env_int("QUERY_EMBED_CACHE_SIZE", 512, minimum=0)


class _InflightEmbedding:

    __slots__ = ("done", "embedding", "error")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.embedding: list[float] | None = None
        self.error: BaseException | None = None

    def result(self) -> list[float]:
        self.done.wait()
        if self.error is not None:
            raise self.error
        assert self.embedding is not None
        return self.embedding


class QueryEmbeddingCache:

    def __init__(self, max_entries: int = EMBED_CACHE_MAX) -> None:
        self.max_entries = max_entries
        self._cache: dict[tuple[str, str], list[float]] = {}
        self._order: list[tuple[str, str]] = []
        self._lock = threading.Lock()
        self._inflight: dict[tuple[str, str], _InflightEmbedding] = {}

    def embed(self, key: tuple[str, str], compute: Callable[[], list[float]]) -> list[float]:
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._order.remove(key)
                self._order.append(key)
                return cached
            pending = self._inflight.get(key)
            if pending is None:
                owned = self._inflight[key] = _InflightEmbedding()
        if pending is not None:
            return pending.result()
        return self._compute_as_owner(key, compute, owned)

    def seed(self, key: tuple[str, str], embedding: list[float]) -> None:
        with self._lock:
            self._cache[key] = embedding
            self._order.append(key)

    def _compute_as_owner(
        self, key: tuple[str, str], compute: Callable[[], list[float]], record: _InflightEmbedding
    ) -> list[float]:
        try:
            embedding = compute()
        except BaseException as exc:
            record.error = exc
            raise
        else:
            record.embedding = embedding
            with self._lock:
                self._cache[key] = embedding
                self._order.append(key)
                while len(self._order) > self.max_entries:
                    self._cache.pop(self._order.pop(0), None)
            return embedding
        finally:
            with self._lock:
                self._inflight.pop(key, None)
            record.done.set()
