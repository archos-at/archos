from __future__ import annotations

import logging
import re
from typing import Any

__all__ = [
    "PRESIGNED_REDACTED",
    "PresignedUrlFilter",
    "install_presigned_url_scrubbing",
    "scrub_presigned_urls",
]

PRESIGNED_REDACTED = "<presigned-url-redacted>"

_SIGNATURE_PARAMS = (
    "x-amz-signature",
    "x-amz-credential",
    "x-amz-security-token",
    "awsaccesskeyid",
    "signature",
)

_URL_RE = re.compile(r"https?://[^\s\"'<>\\]+")


def _is_signed(url: str) -> bool:
    query = url.partition("?")[2].lower()
    if not query:
        return False
    return any(f"{name}=" in query for name in _SIGNATURE_PARAMS)


def _strip_trailing_punctuation(url: str) -> tuple[str, str]:
    trailing = ""
    while url and url[-1] in ".,;:!?)]}":
        trailing = url[-1] + trailing
        url = url[:-1]
    return url, trailing


def scrub_presigned_urls(text: str) -> str:
    if "http" not in text:
        return text

    def replace(match: re.Match[str]) -> str:
        url, trailing = _strip_trailing_punctuation(match.group(0))
        return (PRESIGNED_REDACTED + trailing) if _is_signed(url) else match.group(0)

    return _URL_RE.sub(replace, text)


def _scrub_value(value: Any) -> Any:
    return scrub_presigned_urls(value) if isinstance(value, str) else value


class PresignedUrlFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = scrub_presigned_urls(record.msg)

        if isinstance(record.args, dict):
            record.args = {key: _scrub_value(value) for key, value in record.args.items()}
        elif isinstance(record.args, tuple):
            record.args = tuple(_scrub_value(value) for value in record.args)

        if record.exc_info and record.exc_info[0] is not None:
            if not record.exc_text:
                import traceback

                record.exc_text = "".join(traceback.format_exception(*record.exc_info))
            record.exc_text = scrub_presigned_urls(record.exc_text)

        return True


def install_presigned_url_scrubbing(logger: logging.Logger | None = None) -> None:
    target = logger if logger is not None else logging.getLogger()
    for handler in target.handlers:
        if not any(isinstance(existing, PresignedUrlFilter) for existing in handler.filters):
            handler.addFilter(PresignedUrlFilter())
