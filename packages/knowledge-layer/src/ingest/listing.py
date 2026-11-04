"""What a collection's chunks say about each file they come from. Pure.

A listing reads one payload-limited scroll (:data:`LISTING_FIELDS`, no chunk
text) and folds each file's points into its ``FileInfo``: how many chunks,
which pages and content types, its size and type, and when it was indexed.
The document's own facts come from its metadata row, which the routes merge
in, and the drift checks compare the two (``routes/maintenance.py``,
``factory.reconcile_collection_summaries``).

A listing outlives the job record (24 hours, ``FILE_TRACKING_RETENTION_SECONDS``),
so what it shows must come from fields every writer puts on a chunk. Only the
plain-text reader stamps ``creation_date`` / ``last_modified_date`` /
``file_type``; every point carries ``indexed_at`` (``vector_store.writes``), so
the ingest date falls back to it and the type to the file name's.
"""

from __future__ import annotations

import mimetypes
from collections.abc import Iterable
from collections.abc import Mapping
from datetime import UTC
from datetime import datetime
from typing import Any

from agent.knowledge.schema import FileInfo
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import stable_file_id

LISTING_FIELDS = (
    "file_name",
    "file_size",
    "file_type",
    "creation_date",
    "last_modified_date",
    "indexed_at",
    "content_type",
    "page_label",
)
#: Fields a file takes from its first chunk that has them.
_FIRST_SEEN = ("file_size", "file_type", "creation_date", "last_modified_date")


def from_epoch(seconds: int | None) -> datetime | None:
    """An ``indexed_at`` value as an aware UTC datetime; None stays None."""
    return datetime.fromtimestamp(seconds, UTC) if seconds is not None else None


def from_iso(value: Any) -> datetime | None:
    """An ISO timestamp as a datetime, or None when it is absent or not one."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def files_from_payloads(collection_name: str, payloads: Iterable[Mapping[str, Any] | None]) -> dict[str, FileInfo]:
    """``file_name -> FileInfo`` for each file the payloads hold chunks of."""
    stats: dict[str, dict[str, Any]] = {}
    for payload in payloads:
        m = payload or {}
        if "file_name" not in m:
            continue
        seen = stats.setdefault(m["file_name"], {"chunk_count": 0, "content_types": set(), "pages": set()})
        seen["chunk_count"] += 1
        for key in _FIRST_SEEN:
            if key in m and seen.get(key) is None:
                seen[key] = m[key]
        # The newest write is the Fassung the collection holds now.
        if isinstance(m.get("indexed_at"), int | float):
            seen["indexed_at"] = max(seen.get("indexed_at") or 0, m["indexed_at"])
        if "content_type" in m:
            seen["content_types"].add(m["content_type"])
        if "page_label" in m:
            seen["pages"].add(m["page_label"])
    return {file_name: _file_info(collection_name, file_name, seen) for file_name, seen in stats.items()}


def _file_info(collection_name: str, file_name: str, seen: dict[str, Any]) -> FileInfo:
    return FileInfo(
        file_id=stable_file_id(collection_name, file_name),
        file_name=file_name,
        collection_name=collection_name,
        status=FileStatus.SUCCESS,
        chunk_count=seen["chunk_count"],
        file_size=seen.get("file_size"),
        uploaded_at=from_iso(seen.get("creation_date")),
        ingested_at=from_iso(seen.get("last_modified_date")) or from_epoch(seen.get("indexed_at")),
        metadata={
            "content_types": sorted(seen["content_types"]),
            "page_count": len(seen["pages"]),
            "file_type": seen.get("file_type") or mimetypes.guess_type(file_name)[0],
        },
    )
