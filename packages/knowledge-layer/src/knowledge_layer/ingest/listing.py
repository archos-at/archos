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
    "document_id",
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


def listing_key(file_name: str, document_id: str | None) -> str:
    return f"id:{document_id}" if document_id else file_name


def sole_holders(entries: Iterable[tuple[str, str, str | None]]) -> dict[str, str]:
    held: dict[str, set[str]] = {}
    for key, file_name, document_id in entries:
        if document_id:
            held.setdefault(file_name, set()).add(key)
    return {file_name: next(iter(keys)) for file_name, keys in held.items() if len(keys) == 1}


def by_owner(entries: Mapping[str, FileInfo], holders: Mapping[str, str]) -> dict[str, FileInfo]:
    owned: dict[str, FileInfo] = {}
    unclaimed: list[FileInfo] = []
    for key, info in entries.items():
        if not info.document_id and info.file_name in holders:
            unclaimed.append(info)
        else:
            owned[key] = info
    for info in unclaimed:
        owned.setdefault(holders[info.file_name], info)
    return owned


def files_from_payloads(collection_name: str, payloads: Iterable[Mapping[str, Any] | None]) -> dict[str, FileInfo]:
    stats: dict[str, dict[str, Any]] = {}
    for payload in payloads:
        m = payload or {}
        if "file_name" in m:
            document_id = str(m.get("document_id") or "") or None
            _count(stats.setdefault(listing_key(m["file_name"], document_id), _unseen(m["file_name"], document_id)), m)
    holders = sole_holders((key, seen["file_name"], seen["document_id"]) for key, seen in stats.items())
    for key in [key for key, seen in stats.items() if not seen["document_id"] and seen["file_name"] in holders]:
        unclaimed = stats.pop(key)
        _fold(stats[holders[unclaimed["file_name"]]], unclaimed)
    return {key: _file_info(collection_name, seen) for key, seen in stats.items()}


def _unseen(file_name: str, document_id: str | None) -> dict[str, Any]:
    return {
        "file_name": file_name,
        "document_id": document_id,
        "chunk_count": 0,
        "content_types": set(),
        "pages": set(),
    }


def _count(seen: dict[str, Any], m: Mapping[str, Any]) -> None:
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


def _fold(into: dict[str, Any], part: dict[str, Any]) -> None:
    into["chunk_count"] += part["chunk_count"]
    into["content_types"] |= part["content_types"]
    into["pages"] |= part["pages"]
    for key in _FIRST_SEEN:
        if into.get(key) is None:
            into[key] = part.get(key)
    if part.get("indexed_at"):
        into["indexed_at"] = max(into.get("indexed_at") or 0, part["indexed_at"])


def _file_info(collection_name: str, seen: dict[str, Any]) -> FileInfo:
    file_name, document_id = seen["file_name"], seen["document_id"]
    return FileInfo(
        file_id=stable_file_id(collection_name, file_name, document_id),
        file_name=file_name,
        collection_name=collection_name,
        document_id=document_id,
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
