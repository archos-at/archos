"""A failed file's category, from its reason and the exception that ended it.

The category decides whether reading the file again is worth anything
(``apps/workspace/bff/documents/retry-policy.ts``). The reasons the adapter
writes on purpose are pinned in ``test_ingest_failure_prefix_parity.py``; these
pin what the per-file catch meets: an exception and ``str(e)``.
"""

import json

import pytest

from agent.knowledge.ingest_failures import FAILURE_CATEGORIES
from agent.knowledge.ingest_failures import classify_failure
from agent.knowledge.ingest_failures import verdict_for


# Stand-ins named as the SDKs name theirs: the classifier reads names, so a
# test needs neither httpx nor openai nor pdfminer installed to say this.
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
    """A 404 is a misnamed model or base URL: fixing it lets the same file read."""
    assert _verdict(_StatusError(404)) == ("configuration", True)
    assert _verdict(HTTPStatusError(404)) == ("configuration", True)


class _NoAllowedProvider(_StatusError):
    def __init__(self, status_code: int):
        super().__init__(status_code)
        self.args = (f"Error code: {status_code} - No allowed providers are available for the selected model.",)


@pytest.mark.parametrize("status", [404, 503])
def test_no_allowed_eu_endpoint_now_is_transient(status):
    """An EU-only page read (`DataPolicy.for_page_reads`) the provider cannot place passes when an endpoint is back."""
    assert _verdict(_NoAllowedProvider(status)) == ("transient", True)
    assert _verdict(RuntimeError("x"), "Error code: 404 - No allowed providers are available") == ("transient", True)


def test_a_model_without_a_zdr_endpoint_stays_configuration():
    error = _StatusError(404)
    error.args = ("Error code: 404 - No endpoints found matching your data policy",)
    assert _verdict(error) == ("configuration", True)


def test_an_upstream_answer_that_fails_its_model_is_not_blamed_on_the_file():
    """pydantic's ValidationError is a ValueError, and it is the answer's shape, not the bytes."""
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
    """A JSONDecodeError is a ValueError, and almost always the provider's answer, not the bytes."""
    exc = json.JSONDecodeError("Expecting value", "<html>", 0)
    assert _verdict(exc) == ("unknown", True)


def test_what_nothing_recognises_stays_retryable():
    assert _verdict(RuntimeError("something odd")) == ("unknown", True)
    assert (classify_failure(None).category, classify_failure("").retryable) == ("unknown", True)


def test_a_reason_prefix_beats_the_exception():
    """The adapter's deliberate reason is the more specific statement."""
    verdict = classify_failure("vlm_not_configured: image ingestion requires VLM_API_KEY", TimeoutError())
    assert verdict.category == "configuration"


def test_the_image_paths_ambiguous_sentence_is_not_a_verdict_on_the_bytes():
    """It says "corrupted file or VLM failure": retrying it must stay possible."""
    verdict = classify_failure("Image could not be decoded or captioned (corrupted file or VLM failure)")
    assert verdict.retryable is True


@pytest.mark.parametrize("category", FAILURE_CATEGORIES)
def test_only_lasting_categories_refuse_a_retry(category):
    assert verdict_for(category).retryable is (category not in ("deterministic", "quarantined"))


class _PaymentRequired(Exception):
    """OpenRouter's 402 as the openai SDK raises it: the status and the provider's sentence."""

    def __init__(self, message: str):
        super().__init__(f"Error code: 402 - {{'error': {{'message': '{message}', 'code': 402}}}}")
        self.status_code = 402


_IN_FLIGHT = "Request would exceed your available credits given your current in-flight requests"


def test_a_402_for_credits_held_by_requests_in_flight_is_capacity_not_the_file():
    """2026-11: a burst of vision calls reserved the credits; the next call got 402
    and its file was failed for good, though the same call passes once they finish."""
    assert _verdict(_PaymentRequired(_IN_FLIGHT)) == ("transient", True)


def test_the_in_flight_402_is_transient_from_its_message_alone():
    assert classify_failure(f"Error code: 402 - {_IN_FLIGHT}").category == "transient"


@pytest.mark.parametrize("message", ["Insufficient credits", "This request requires more credits"])
def test_a_402_for_an_account_out_of_credits_stays_refused(message):
    assert _verdict(_PaymentRequired(message)) == ("deterministic", False)
