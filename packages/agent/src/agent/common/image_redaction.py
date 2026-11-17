from __future__ import annotations

import hashlib
import re
from typing import Any

_SLASH = r"\\{0,3}/"
_DATA_URL = re.compile(
    rf"data:image{_SLASH}[A-Za-z0-9.+-]+(?:;[A-Za-z0-9.=_-]+)*?"
    rf"(?:;base64,(?:[A-Za-z0-9+=_-]|{_SLASH}|\\{{1,3}}[rn]|[\r\n])+"
    r"|,[^\s\"'<>()\[\]{}]+)"
)


def _placeholder(match: re.Match[str]) -> str:
    digest = hashlib.sha256(match.group(0).encode("utf-8")).hexdigest()[:8]
    return f"[image, {len(match.group(0))} chars, sha256:{digest}]"


def redact_inline_images(value: Any) -> Any:
    if isinstance(value, str):
        return _DATA_URL.sub(_placeholder, value) if "data:image" in value else value
    if isinstance(value, list):
        return [redact_inline_images(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_inline_images(item) for item in value)
    if isinstance(value, dict):
        return {key: redact_inline_images(item) for key, item in value.items()}
    return value
