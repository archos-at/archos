from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final
from typing import Literal

FailureCategory = Literal["transient", "configuration", "deterministic", "quarantined", "unknown"]

TRANSIENT: Final = "transient"
CONFIGURATION: Final = "configuration"
DETERMINISTIC: Final = "deterministic"
QUARANTINED: Final = "quarantined"
UNKNOWN: Final = "unknown"

FAILURE_CATEGORIES: Final[tuple[FailureCategory, ...]] = (TRANSIENT, CONFIGURATION, DETERMINISTIC, QUARANTINED, UNKNOWN)

_RETRYABLE: Final[dict[FailureCategory, bool]] = {
    TRANSIENT: True,
    CONFIGURATION: True,
    DETERMINISTIC: False,
    QUARANTINED: False,
    UNKNOWN: True,
}

PREFIX_CATEGORIES: Final[dict[str, FailureCategory]] = {
    "interrupted": TRANSIENT,
    "unreadable_job": TRANSIENT,
    "original_download_failed": TRANSIENT,
    "office_rendition_required": TRANSIENT,
    "document_deleted": TRANSIENT,
    "vlm_not_configured": CONFIGURATION,
    "screening_unavailable": CONFIGURATION,
    "pdf_pages_unreadable": DETERMINISTIC,
    "quarantined": QUARANTINED,
}


REASON_CATEGORIES: Final[dict[str, FailureCategory]] = {
    **PREFIX_CATEGORIES,
    "timeout": TRANSIENT,
    "connection_failed": TRANSIENT,
    "rate_limited": TRANSIENT,
    "upstream_unavailable": TRANSIENT,
    "credits_in_flight": TRANSIENT,
    "no_allowed_provider": TRANSIENT,
    "upstream_refused": CONFIGURATION,
    "upstream_rejected": DETERMINISTIC,
    "encrypted": DETERMINISTIC,
    "pdf_unparseable": DETERMINISTIC,
    "zip_unreadable": DETERMINISTIC,
    "image_unreadable": DETERMINISTIC,
    "image_too_large": DETERMINISTIC,
    "no_content": DETERMINISTIC,
    "raw_binary_content": DETERMINISTIC,
    "wrong_file_type": DETERMINISTIC,
    "empty_file": DETERMINISTIC,
    "unparseable": DETERMINISTIC,
    UNKNOWN: UNKNOWN,
}


@dataclass(frozen=True)
class FailureVerdict:
    category: FailureCategory
    retryable: bool
    reason: str


def verdict_of(reason: str) -> FailureVerdict:
    category = REASON_CATEGORIES[reason]
    return FailureVerdict(category, _RETRYABLE[category], reason)


_TRANSIENT_EXCEPTIONS: Final[dict[str, str]] = {
    "TimeoutError": "timeout",
    "TimeoutException": "timeout",
    "APITimeoutError": "timeout",
    "ReadTimeoutError": "timeout",
    "ConnectionError": "connection_failed",
    "TransportError": "connection_failed",
    "NetworkError": "connection_failed",
    "RemoteProtocolError": "connection_failed",
    "APIConnectionError": "connection_failed",
    "ProtocolError": "connection_failed",
    "InternalServerError": "upstream_unavailable",
    "RateLimitError": "rate_limited",
}

_DETERMINISTIC_EXCEPTIONS: Final[dict[str, str]] = {
    "PDFPasswordIncorrect": "encrypted",
    "PDFEncryptionError": "encrypted",
    "PDFSyntaxError": "pdf_unparseable",
    "PDFTypeError": "pdf_unparseable",
    "PDFValueError": "pdf_unparseable",
    "PSEOF": "pdf_unparseable",
    "PSSyntaxError": "pdf_unparseable",
    "PdfiumError": "pdf_unparseable",
    "BadZipFile": "zip_unreadable",
    "InvalidFileException": "zip_unreadable",
    "PackageNotFoundError": "zip_unreadable",
    "UnidentifiedImageError": "image_unreadable",
    "DecompressionBombError": "image_too_large",
}

_IN_FLIGHT_CREDITS = re.compile(r"\bcredits?\b.*\bin[\s-]?flight\b|\bin[\s-]?flight\b.*\bcredits?\b", re.I | re.S)
_NO_ALLOWED_PROVIDER = re.compile(
    r"no allowed providers?|no endpoints? (?:found|available)(?! matching your data policy)", re.I
)
_ENCRYPTED = re.compile(r"password|encrypt", re.I)
_TRANSIENT_TEXT: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"\btimed?[\s_-]?out\b|\btimeout\b", re.I), "timeout"),
    (re.compile(r"connection (?:reset|refused|aborted|error)", re.I), "connection_failed"),
    (re.compile(r"rate limit|too many requests", re.I), "rate_limited"),
    (
        re.compile(
            r"temporarily unavailable|service unavailable|bad gateway|gateway time-?out|"
            r"\b(?:http|status|code|error)\b\D{0,12}\b5\d\d\b|\b5\d\d internal server error\b",
            re.I,
        ),
        "upstream_unavailable",
    ),
    (_IN_FLIGHT_CREDITS, "credits_in_flight"),
    (_NO_ALLOWED_PROVIDER, "no_allowed_provider"),
)
_DETERMINISTIC_TEXT: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"^no content extracted\b", re.I), "no_content"),
    (_ENCRYPTED, "encrypted"),
    (re.compile(r"raw pdf/binary content", re.I), "raw_binary_content"),
    (re.compile(r"not a (?:pdf|zip)\b", re.I), "wrong_file_type"),
    (re.compile(r"\bempty file\b|\bfile is empty\b", re.I), "empty_file"),
)
_TEXT_REASONS: Final = (*_TRANSIENT_TEXT, *_DETERMINISTIC_TEXT)
_RETRYABLE_STATUS: Final[dict[int, str]] = {408: "timeout", 409: "upstream_unavailable", 425: "upstream_unavailable"}
_PREFIX = re.compile(r"^([a-z][a-z_]*):")


def no_allowed_provider(error: str | None, exc: BaseException | None = None) -> bool:
    for candidate in (exc, getattr(exc, "__cause__", None)):
        if (
            candidate is not None
            and _status_of(candidate) in (404, 503)
            and _NO_ALLOWED_PROVIDER.search(str(candidate))
        ):
            return True
    return bool(error) and _NO_ALLOWED_PROVIDER.search(error or "") is not None


def classify_failure(error: str | None, exc: BaseException | None = None) -> FailureVerdict:
    message = (error or "").strip()
    reason = _from_prefix(message)
    if reason is None and exc is not None:
        reason = _from_exception(exc)
    if reason is None:
        reason = _from_text(message or (str(exc) if exc is not None else ""))
    if reason is None and exc is not None and _is_parse_error(exc):
        reason = "unparseable"
    return verdict_of(reason or UNKNOWN)


def _from_prefix(message: str) -> str | None:
    match = _PREFIX.match(message)
    return match.group(1) if match and match.group(1) in PREFIX_CATEGORIES else None


def _named(exc: BaseException, reasons: dict[str, str]) -> str | None:
    return next((reasons[cls.__name__] for cls in type(exc).__mro__ if cls.__name__ in reasons), None)


def _names(exc: BaseException) -> set[str]:
    return {cls.__name__ for cls in type(exc).__mro__}


def _from_exception(exc: BaseException) -> str | None:
    transient = _named(exc, _TRANSIENT_EXCEPTIONS)
    if transient is not None:
        return transient
    deterministic = _named(exc, _DETERMINISTIC_EXCEPTIONS)
    if deterministic is not None:
        return "encrypted" if _ENCRYPTED.search(str(exc)) else deterministic
    return _from_status_code(exc)


def _status_of(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    if not isinstance(status, int):
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return status if isinstance(status, int) else None


def credits_in_flight(error: str | None, exc: BaseException | None = None) -> bool:
    for candidate in (exc, getattr(exc, "__cause__", None)):
        if candidate is not None and _status_of(candidate) == 402 and _IN_FLIGHT_CREDITS.search(str(candidate)):
            return True
    return bool(error) and _IN_FLIGHT_CREDITS.search(error or "") is not None


def _from_status_code(exc: BaseException) -> str | None:
    status = _status_of(exc)
    if status is None or status < 400:
        return None
    if status == 429:
        return "rate_limited"
    if status >= 500 or status in _RETRYABLE_STATUS:
        return _RETRYABLE_STATUS.get(status, "upstream_unavailable")
    if status == 402 and _IN_FLIGHT_CREDITS.search(str(exc)):
        return "credits_in_flight"
    if status == 404 and _NO_ALLOWED_PROVIDER.search(str(exc)):
        return "no_allowed_provider"
    if status in (401, 403, 404):
        return "upstream_refused"
    return "upstream_rejected"


def _from_text(message: str) -> str | None:
    if not message:
        return None
    return next((reason for pattern, reason in _TEXT_REASONS if pattern.search(message)), None)


def _is_parse_error(exc: BaseException) -> bool:
    if not isinstance(exc, ValueError) or isinstance(exc, json.JSONDecodeError):
        return False
    return "ValidationError" not in _names(exc)
