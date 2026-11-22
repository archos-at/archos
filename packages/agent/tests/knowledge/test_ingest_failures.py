import json

import pytest

from agent.knowledge.ingest_failures import PREFIX_CATEGORIES
from agent.knowledge.ingest_failures import REASON_CATEGORIES
from agent.knowledge.ingest_failures import classify_failure
from agent.knowledge.ingest_failures import verdict_of


class ReadTimeout(Exception):
    pass


class TimeoutException(ReadTimeout):  # httpx's base sits above the concrete class
    pass


class APIConnectionError(Exception):
    pass


class PDFPasswordIncorrect(Exception):
    pass


class PdfiumError(RuntimeError):
    pass


class _StatusError(Exception):
    def __init__(self, status_code: int):
        super().__init__(f"Error code: {status_code}")
        self.status_code = status_code


class _Response:
    def __init__(self, status_code: int):
        self.status_code = status_code


class HTTPStatusError(Exception):
    def __init__(self, status_code: int):
        super().__init__("upstream refused")
        self.response = _Response(status_code)


def _verdict(exc: BaseException, message: str | None = None):
    v = classify_failure(str(exc) if message is None else message, exc)
    return v.category, v.retryable


@pytest.mark.parametrize(
    "exc",
    [
        TimeoutError("read timed out"),
        ConnectionResetError("connection reset by peer"),
        TimeoutException("timed out"),
        APIConnectionError("Connection error."),
        _StatusError(503),
        _StatusError(429),
        HTTPStatusError(502),
    ],
    ids=["timeout", "connection-reset", "httpx-timeout", "openai-connection", "5xx", "429", "httpx-502"],
)
def test_a_failure_of_the_moment_is_transient(exc):
    assert _verdict(exc) == ("transient", True)


@pytest.mark.parametrize(
    "exc",
    [
        PDFPasswordIncorrect(""),
        PdfiumError("Failed to load document (PDFium: Incorrect password error)."),
        ValueError("Raw PDF/binary content detected; refusing to index"),
        ValueError("Document is empty; nothing to split"),
        UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
        _StatusError(413),
    ],
    ids=["encrypted", "pdfium", "binary-guard", "splitter", "decode", "413"],
)
def test_a_failure_of_the_bytes_is_deterministic(exc):
    assert _verdict(exc) == ("deterministic", False)


def test_a_refused_key_is_configuration():
    assert _verdict(_StatusError(401)) == ("configuration", True)


def test_a_missing_model_or_endpoint_is_configuration_not_the_bytes():
    assert _verdict(_StatusError(404)) == ("configuration", True)
    assert _verdict(HTTPStatusError(404)) == ("configuration", True)


class _NoAllowedProvider(_StatusError):
    def __init__(self, status_code: int):
        super().__init__(status_code)
        self.args = (f"Error code: {status_code} - No allowed providers are available for the selected model.",)


@pytest.mark.parametrize("status", [404, 503])
def test_no_allowed_eu_endpoint_now_is_transient(status):
    assert _verdict(_NoAllowedProvider(status)) == ("transient", True)
    assert _verdict(RuntimeError("x"), "Error code: 404 - No allowed providers are available") == ("transient", True)


def test_a_model_without_a_zdr_endpoint_stays_configuration():
    error = _StatusError(404)
    error.args = ("Error code: 404 - No endpoints found matching your data policy",)
    assert _verdict(error) == ("configuration", True)


def test_an_upstream_answer_that_fails_its_model_is_not_blamed_on_the_file():
    from pydantic import BaseModel
    from pydantic import ValidationError

    class _Answer(BaseModel):
        data: list[float]

    with pytest.raises(ValidationError) as caught:
        _Answer.model_validate({"data": "not a list"})
    assert _verdict(caught.value) == ("unknown", True)


def test_the_adapters_own_sentence_for_an_empty_file_is_deterministic():
    message = "No content extracted (file may be password-protected, corrupted, or empty)"
    assert (classify_failure(message).category, classify_failure(message).retryable) == ("deterministic", False)


def test_a_garbled_upstream_answer_is_not_blamed_on_the_file():
    exc = json.JSONDecodeError("Expecting value", "<html>", 0)
    assert _verdict(exc) == ("unknown", True)


def test_what_nothing_recognises_stays_retryable():
    assert _verdict(RuntimeError("something odd")) == ("unknown", True)
    assert (classify_failure(None).category, classify_failure("").retryable) == ("unknown", True)


def test_a_reason_prefix_beats_the_exception():
    verdict = classify_failure("vlm_not_configured: image ingestion requires VLM_API_KEY", TimeoutError())
    assert verdict.category == "configuration"


def test_the_image_paths_ambiguous_sentence_is_not_a_verdict_on_the_bytes():
    verdict = classify_failure("Image could not be decoded or captioned (corrupted file or VLM failure)")
    assert verdict.retryable is True


@pytest.mark.parametrize(("reason", "category"), REASON_CATEGORIES.items())
def test_only_lasting_categories_refuse_a_retry(reason, category):
    verdict = verdict_of(reason)
    assert (verdict.category, verdict.reason) == (category, reason)
    assert verdict.retryable is (category not in ("deterministic", "quarantined"))


class PDFSyntaxError(Exception):
    pass


class BadZipFile(Exception):
    pass


class UnidentifiedImageError(OSError):
    pass


class DecompressionBombError(Exception):
    pass


class RateLimitError(Exception):
    pass


_NO_CONTENT = "No content extracted (file may be password-protected, corrupted, or empty)"

_NAMED_FAILURES = [
    ("no_content", _NO_CONTENT, None),
    ("raw_binary_content", None, ValueError("Raw PDF/binary content detected; refusing to index")),
    ("encrypted", None, PDFPasswordIncorrect("")),
    ("encrypted", None, PdfiumError("Failed to load document (PDFium: Incorrect password error).")),
    ("encrypted", "Datei.pdf is encrypted", None),
    ("pdf_unparseable", None, PdfiumError("Failed to load document (PDFium: Data format error).")),
    ("pdf_unparseable", None, PDFSyntaxError("No /Root object")),
    ("zip_unreadable", None, BadZipFile("File is not a zip file")),
    ("image_unreadable", None, UnidentifiedImageError("cannot identify image file")),
    ("image_too_large", None, DecompressionBombError("Image size exceeds limit")),
    ("wrong_file_type", "plan.pdf is not a PDF", None),
    ("empty_file", "The file is empty", None),
    ("unparseable", None, ValueError("Document is empty; nothing to split")),
    ("upstream_rejected", None, _StatusError(413)),
    ("upstream_refused", None, _StatusError(401)),
    ("upstream_unavailable", None, _StatusError(503)),
    ("upstream_unavailable", "Bad Gateway", None),
    ("upstream_unavailable", None, _StatusError(425)),
    ("upstream_conflict", None, _StatusError(409)),
    ("rate_limited", None, _StatusError(429)),
    ("rate_limited", None, RateLimitError("slow down")),
    ("timeout", None, TimeoutError("read timed out")),
    ("timeout", None, TimeoutException("")),
    ("timeout", None, _StatusError(408)),
    ("connection_failed", None, APIConnectionError("Connection error.")),
    ("connection_failed", "Connection reset by peer", None),
    ("no_allowed_provider", "Error code: 404 - No allowed providers are available", None),
    ("unknown", "something odd", RuntimeError("something odd")),
]


@pytest.mark.parametrize(("reason", "message", "exc"), _NAMED_FAILURES)
def test_each_failure_names_its_reason(reason, message, exc):
    verdict = classify_failure(str(exc) if message is None else message, exc)
    assert verdict.reason == reason
    assert verdict.category == REASON_CATEGORIES[reason]


def test_every_reason_outside_the_prefixes_is_named_by_a_case():
    named = {reason for reason, _, _ in _NAMED_FAILURES} | {"credits_in_flight"}
    assert named == set(REASON_CATEGORIES) - set(PREFIX_CATEGORIES)


@pytest.mark.parametrize("prefix", PREFIX_CATEGORIES)
def test_a_known_prefix_is_its_own_reason(prefix):
    assert classify_failure(f"{prefix}: Meier GmbH.pdf").reason == prefix


def test_a_prefix_nobody_listed_is_not_a_reason():
    assert classify_failure("meier_gmbh: could not be read").reason == "unknown"


def test_a_reason_is_a_slug_the_event_may_carry():
    import re

    assert all(re.fullmatch(r"[a-z][a-z0-9_]{1,40}", reason) for reason in REASON_CATEGORIES)


class _PaymentRequired(Exception):
    def __init__(self, message: str):
        super().__init__(f"Error code: 402 - {{'error': {{'message': '{message}', 'code': 402}}}}")
        self.status_code = 402


_IN_FLIGHT = "Request would exceed your available credits given your current in-flight requests"


def test_a_402_for_credits_held_by_requests_in_flight_is_capacity_not_the_file():
    assert _verdict(_PaymentRequired(_IN_FLIGHT)) == ("transient", True)
    assert classify_failure(None, _PaymentRequired(_IN_FLIGHT)).reason == "credits_in_flight"


def test_the_in_flight_402_is_transient_from_its_message_alone():
    assert classify_failure(f"Error code: 402 - {_IN_FLIGHT}").category == "transient"


@pytest.mark.parametrize("message", ["Insufficient credits", "This request requires more credits"])
def test_a_402_for_an_account_out_of_credits_stays_refused(message):
    assert _verdict(_PaymentRequired(message)) == ("deterministic", False)
