from __future__ import annotations

import base64

BASE64 = "base64"

PREVIOUS_CONTENT_KEY = "previous_content"
PREVIOUS_ENCODING_KEY = "previous_encoding"
PREVIOUS_VERSION_KEY = "previous_version"

PREVIOUS_KEYS = (PREVIOUS_CONTENT_KEY, PREVIOUS_ENCODING_KEY, PREVIOUS_VERSION_KEY)

DERIVED_FROM_KEY = "derived_from"


def draft_bytes(text: str) -> int:
    return len(text.encode("utf-8"))


def stored_size(value: dict) -> int:
    raw = value.get("content")
    text = "\n".join(raw) if isinstance(raw, list) else str(raw or "")
    if value.get("encoding") == BASE64:
        return len(base64.b64decode(text)) if text else 0
    return draft_bytes(text)


def stored_bytes(value: dict) -> bytes:
    raw = value.get("content")
    text = "\n".join(raw) if isinstance(raw, list) else str(raw or "")
    return base64.b64decode(text) if value.get("encoding") == BASE64 else text.encode("utf-8")


def previous_size(value: dict) -> int:
    if not value.get(PREVIOUS_VERSION_KEY):
        return 0
    return stored_size({"content": value.get(PREVIOUS_CONTENT_KEY), "encoding": value.get(PREVIOUS_ENCODING_KEY)})


def previous_bytes(value: dict) -> bytes:
    return stored_bytes({"content": value.get(PREVIOUS_CONTENT_KEY), "encoding": value.get(PREVIOUS_ENCODING_KEY)})


def derived_from_value(value: dict) -> dict[str, str]:
    raw = value.get(DERIVED_FROM_KEY)
    if not isinstance(raw, dict):
        return {}
    return {key: str(raw[key]) for key in ("document_id", "name", "folder_id") if raw.get(key)}


def history_of(value: dict, version: int) -> dict:
    if version <= 0 or "content" not in value:
        return {}
    return {
        PREVIOUS_CONTENT_KEY: value.get("content"),
        PREVIOUS_ENCODING_KEY: value.get("encoding") or "utf-8",
        PREVIOUS_VERSION_KEY: version,
    }
