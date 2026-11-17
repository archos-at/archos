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


@dataclass(frozen=True)
class FailureVerdict:
    category: FailureCategory
    retryable: bool


def verdict_for(category: FailureCategory) -> FailureVerdict:
    return FailureVerdict(category, _RETRYABLE[category])


_TRANSIENT_EXCEPTIONS: Final = frozenset(
    {
        "TimeoutError",
        "ConnectionError",
        "TimeoutException",
        "TransportError",
        "NetworkError",
        "RemoteProtocolError",
        "APIConnectionError",
        "APITimeoutError",
        "InternalServerError",
        "RateLimitError",
        "ReadTimeoutError",
        "ProtocolError",
    }
)

_DETERMINISTIC_EXCEPTIONS: Final = frozenset(
    {
        "PDFPasswordIncorrect",
        "PDFEncryptionError",
        "PDFSyntaxError",
        "PDFTypeError",
        "PDFValueError",
        "PSEOF",
        "PSSyntaxError",
        "PdfiumError",
        "BadZipFile",
        "InvalidFileException",
        "PackageNotFoundError",
        "UnidentifiedImageError",
        "DecompressionBombError",
    }
)

_DETERMINISTIC_TEXT = re.compile(
    r"^no content extracted\b|password|encrypt|raw pdf/binary content|not a (?:pdf|zip)\b|"
    r"\bempty file\b|\bfile is empty\b",
    re.IGNORECASE,
)
_TRANSIENT_TEXT = re.compile(
    r"\btimed?[\s_-]?out\b|\btimeout\b|connection (?:reset|refused|aborted|error)|"
    r"temporarily unavailable|service unavailable|bad gateway|gateway time-?out|rate limit|too many requests|"
    r"\b(?:http|status|code|error)\b\D{0,12}\b5\d\d\b|\b5\d\d internal server error\b",
    re.IGNORECASE,
)
_PREFIX = re.compile(r"^([a-z][a-z_]*):")
_IN_FLIGHT_CREDITS = re.compile(r"\bcredits?\b.*\bin[\s-]?flight\b|\bin[\s-]?flight\b.*\bcredits?\b", re.I | re.S)
_NO_ALLOWED_PROVIDER = re.compile(
    r"no allowed providers?|no endpoints? (?:found|available)(?! matching your data policy)", re.I
)


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
    by_prefix = _from_prefix(message)
    if by_prefix is not None:
        return verdict_for(by_prefix)
    if exc is not None:
        by_exception = _from_exception(exc)
        if by_exception is not None:
            return verdict_for(by_exception)
    by_text = _from_text(message or (str(exc) if exc is not None else ""))
    if by_text is not None:
        return verdict_for(by_text)
    if exc is not None and _is_parse_error(exc):
        return verdict_for(DETERMINISTIC)
    return verdict_for(UNKNOWN)


def _from_prefix(message: str) -> FailureCategory | None:
    match = _PREFIX.match(message)
    return PREFIX_CATEGORIES.get(match.group(1)) if match else None


def _names(exc: BaseException) -> set[str]:
    return {cls.__name__ for cls in type(exc).__mro__}


def _from_exception(exc: BaseException) -> FailureCategory | None:
    names = _names(exc)
    if names & _TRANSIENT_EXCEPTIONS:
        return TRANSIENT
    if names & _DETERMINISTIC_EXCEPTIONS:
        return DETERMINISTIC
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


def _from_status_code(exc: BaseException) -> FailureCategory | None:
    status = _status_of(exc)
    if status is None or status < 400:
        return None
    if status >= 500 or status in (408, 409, 425, 429):
        return TRANSIENT
    if status == 402 and _IN_FLIGHT_CREDITS.search(str(exc)):
        return TRANSIENT
    if status == 404 and _NO_ALLOWED_PROVIDER.search(str(exc)):
        return TRANSIENT
    if status in (401, 403, 404):
        return CONFIGURATION
    return DETERMINISTIC


def _from_text(message: str) -> FailureCategory | None:
    if not message:
        return None
    if _TRANSIENT_TEXT.search(message) or _IN_FLIGHT_CREDITS.search(message) or _NO_ALLOWED_PROVIDER.search(message):
        return TRANSIENT
    if _DETERMINISTIC_TEXT.search(message):
        return DETERMINISTIC
    return None


def _is_parse_error(exc: BaseException) -> bool:
    if not isinstance(exc, ValueError) or isinstance(exc, json.JSONDecodeError):
        return False
    return "ValidationError" not in _names(exc)
