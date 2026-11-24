from __future__ import annotations

import contextlib
import logging
import os
from pathlib import Path
from typing import Any

from knowledge_layer.ingest.deferred_files import is_deferred
from knowledge_layer.ingest.deferred_files import run_deferred_download

logger = logging.getLogger(__name__)

RENDITION_INDEXED_EXTENSIONS = frozenset(
    {".docx", ".docm", ".doc", ".odt", ".rtf", ".pptx", ".pptm", ".ppt", ".odp", ".xls", ".ods", ".dxf"}
)

OFFICE_RENDITION_REQUIRED = (
    "office_rendition_required: Word, presentation and DXF files are indexed from their PDF "
    "rendition, and none could be read (conversion disabled or failed, or the download failed)"
)


def requires_rendition(file_name: str, file_path: str) -> bool:
    return (Path(file_name).suffix or Path(file_path).suffix).lower() in RENDITION_INDEXED_EXTENSIONS


RENDITION_CONFIG_LISTS = ("extraction_paths", "preview_paths")


def align_extraction_paths(job_config: dict[str, Any], kept_indices: list[int]) -> None:
    for key in RENDITION_CONFIG_LISTS:
        if key in job_config:
            _align(job_config, key, kept_indices)


def _align(job_config: dict[str, Any], key: str, kept_indices: list[int]) -> None:
    renditions = job_config.get(key) or []
    job_config[key] = [renditions[i] if i < len(renditions) else None for i in kept_indices]
    if not job_config.get("cleanup_files"):
        return
    kept = set(kept_indices)
    for index, path in enumerate(renditions):
        if isinstance(path, str) and index not in kept:
            with contextlib.suppress(OSError):
                os.unlink(path)


def handed_rendition_paths(config: dict[str, Any]) -> list[str]:
    return [path for key in RENDITION_CONFIG_LISTS for path in config.get(key) or [] if isinstance(path, str)]


def resolve_rendition(config: dict[str, Any], index: int, downloaded: list[str]) -> str | None:
    return _resolve(config, "extraction_paths", index, downloaded)


def resolve_preview(config: dict[str, Any], index: int, downloaded: list[str]) -> str | None:
    return _resolve(config, "preview_paths", index, downloaded)


def _resolve(config: dict[str, Any], key: str, index: int, downloaded: list[str]) -> str | None:
    entries = config.get(key) or []
    entry = entries[index] if index < len(entries) else None
    if is_deferred(entry):
        path = run_deferred_download(entry, "PDF rendition")
        if path:
            downloaded.append(path)
        return path
    if not entry:
        return None
    if os.path.exists(entry):
        return entry
    logger.warning("Rendition for file %d is gone before extraction", index)
    return None


def delete_quietly(paths: list[str]) -> None:
    for path in paths:
        with contextlib.suppress(OSError):
            os.unlink(path)
