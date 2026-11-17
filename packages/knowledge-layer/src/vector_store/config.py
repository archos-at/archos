"""How the knowledge layer reaches Qdrant, its one vector store (ADR-0115).

Every value is read from the environment per call: a test, or an operator,
can repoint it without rebuilding a process-wide singleton (``store.reset_store``
drops the client built from it).
"""

from __future__ import annotations

import os

#: One dead pod drained the API's thread pool on 2026-10-12 when the client had no timeout.
REQUEST_TIMEOUT_SECONDS = 30


def qdrant_url() -> str:
    """The Qdrant HTTP endpoint; every read and write of the knowledge layer needs it."""
    url = (os.environ.get("QDRANT_URL") or "").strip()
    if not url:
        raise RuntimeError("QDRANT_URL is not set; the knowledge layer stores every chunk in Qdrant")
    return url


def qdrant_api_key() -> str | None:
    """The API key Qdrant expects, or None for an unauthenticated local instance."""
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
    """Shards for the tenant collection, fixed at creation (open-source Qdrant cannot reshard)."""
    return _positive_int("QDRANT_SHARD_NUMBER", 1)


def replication_factor() -> int:
    """Replicas per shard, fixed at creation; a self-hosted cluster does not re-replicate by itself."""
    return _positive_int("QDRANT_REPLICATION_FACTOR", 1)
