from __future__ import annotations

FILE_CONTENT_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}

SHOWN_CONTENT_TYPES = {**FILE_CONTENT_TYPES, ".csv": "text/csv", ".json": "application/json", ".html": "text/html"}


def file_content_type(path: str) -> str | None:
    lowered = path.lower()
    return next((kind for suffix, kind in FILE_CONTENT_TYPES.items() if lowered.endswith(suffix)), None)


def shown_content_type(path: str) -> str | None:
    lowered = path.lower()
    return next((kind for suffix, kind in SHOWN_CONTENT_TYPES.items() if lowered.endswith(suffix)), None)
