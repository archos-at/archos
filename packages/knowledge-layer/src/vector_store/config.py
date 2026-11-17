from __future__ import annotations

import os

#: One dead pod drained the API's thread pool on 2026-10-12 when the client had no timeout.
REQUEST_TIMEOUT_SECONDS = 30


def qdrant_url() -> str:
    url = (os.environ.get("QDRANT_URL") or "").strip()
    if not url:
        raise RuntimeError("QDRANT_URL is not set; the knowledge layer stores every chunk in Qdrant")
    return url


def qdrant_api_key() -> str | None:
    return (os.environ.get("QDRANT_API_KEY") or "").strip() or None


def _positive_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    value = int(raw)
    if value < 1:
        raise ValueError(f"{name} must be at least 1, got {value}")
    return value


def shard_number() -> int:
    return _positive_int("QDRANT_SHARD_NUMBER", 1)


def replication_factor() -> int:
    return _positive_int("QDRANT_REPLICATION_FACTOR", 1)
