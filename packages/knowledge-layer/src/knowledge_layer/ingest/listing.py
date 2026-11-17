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
_FIRST_SEEN = ("file_size", "file_type", "creation_date", "last_modified_date")


def from_epoch(seconds: int | None) -> datetime | None:
    return datetime.fromtimestamp(seconds, UTC) if seconds is not None else None


def from_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def files_from_payloads(collection_name: str, payloads: Iterable[Mapping[str, Any] | None]) -> dict[str, FileInfo]:
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
