from __future__ import annotations

import httpx
import pytest
from knowledge_layer.ingest import deferred_files
from knowledge_layer.ingest import run_deferred_download

_URL = "http://seaweedfs.test/bucket/doc/plan.pdf?X-Amz-Signature=secret"


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.waits: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch) -> _Clock:
    fake = _Clock()
    monkeypatch.setattr(deferred_files, "_sleep", fake.sleep)
    monkeypatch.setattr(deferred_files, "_monotonic", fake.monotonic)
    return fake


def _status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", _URL)
    return httpx.HTTPStatusError("refused", request=request, response=httpx.Response(status, request=request))


class _Download:
    def __init__(self, *failures: BaseException) -> None:
        self.failures = list(failures)
        self.calls = 0

    def __call__(self) -> str:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "/tmp/plan.pdf"


@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectError("refused"),
        httpx.ReadError("connection reset"),
        httpx.RemoteProtocolError("server disconnected"),
        httpx.ConnectTimeout("connect timed out"),
        ConnectionResetError("reset"),
        _status_error(502),
        _status_error(503),
        _status_error(504),
    ],
    ids=["connect", "read", "dropped", "connect-timeout", "builtin-reset", "502", "503", "504"],
)
def test_a_store_that_is_not_there_for_a_moment_costs_a_wait_not_the_file(clock, failure):
    download = _Download(failure, failure)

    assert run_deferred_download(download, "original") == "/tmp/plan.pdf"
    assert download.calls == 3
    assert clock.waits == [3.0, 6.0]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 500, 301])
def test_an_answer_about_the_request_itself_is_asked_once(clock, status):
    download = _Download(_status_error(status))

    assert run_deferred_download(download, "original") is None
    assert download.calls == 1
    assert clock.waits == []


def test_a_read_that_timed_out_is_not_asked_again(clock):
    download = _Download(httpx.ReadTimeout("read timed out"))

    assert run_deferred_download(download, "original") is None
    assert download.calls == 1


def test_a_store_that_stays_away_fails_the_file_within_the_budget(clock, caplog):
    download = _Download(*[httpx.ConnectError("refused")] * 20)

    assert run_deferred_download(download, "original") is None
    assert clock.waits == [3.0, 6.0, 12.0, 24.0]
    assert download.calls == 5
    assert sum(clock.waits) <= deferred_files.DOWNLOAD_RETRY_BUDGET_SECONDS
    assert 30 <= sum(clock.waits) <= 60


def test_the_log_names_the_failure_and_never_the_url(clock, caplog):
    caplog.set_level("INFO")
    download = _Download(httpx.ConnectError(f"refused {_URL}"), _status_error(403))

    assert run_deferred_download(download, "original") is None
    text = caplog.text
    assert "Download of the original failed: HTTPStatusError (HTTP 403)" in text
    assert "ConnectError" in text
    assert "secret" not in text


def test_a_slow_attempt_counts_against_the_budget(clock):

    def slow_failure() -> str:
        clock.now += 48
        raise httpx.ConnectError("refused")

    assert run_deferred_download(slow_failure, "rendition") is None
    assert clock.waits == []
