from __future__ import annotations

import base64

BASE64 = "base64"

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


def derived_from_value(value: dict) -> dict[str, str]:
    raw = value.get(DERIVED_FROM_KEY)
    if not isinstance(raw, dict):
        return {}
    return {key: str(raw[key]) for key in ("document_id", "name", "content_hash") if raw.get(key)}
