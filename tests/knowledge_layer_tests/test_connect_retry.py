"""The connect-retrying client the ingest worker uses for the BFF and the object store."""

from __future__ import annotations

import socket
import time

import httpx
import pytest
from httpcore._backends.sync import SyncBackend

from agent.common import connect_retry
from agent.common.connect_retry import CONNECT_RETRIES
from agent.common.connect_retry import CONNECT_TIMEOUT_SECONDS
from agent.common.connect_retry import connect_retrying_client


@pytest.fixture(autouse=True)
def _no_host_marked_down():
    connect_retry._down_until.clear()
    yield
    connect_retry._down_until.clear()


def test_the_client_retries_connects_and_follows_no_redirect():
    with connect_retrying_client(read_timeout=7.0) as client:
        assert client.follow_redirects is False
        assert client.timeout.read == 7.0
        assert client.timeout.connect == CONNECT_TIMEOUT_SECONDS
        assert isinstance(client._transport, httpx.HTTPTransport)
        assert client._transport._pool._retries == CONNECT_RETRIES


def _closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_a_refused_connect_is_tried_again_before_it_raises(monkeypatch):
    """Each refused connect is repeated CONNECT_RETRIES times, then the error
    surfaces. The backoff sleeps are skipped; the number of connects is the contract."""
    connects = _count_connects(monkeypatch)
    port = _closed_port()
    with connect_retrying_client(read_timeout=1.0) as client, pytest.raises(httpx.ConnectError):
        client.post(f"http://127.0.0.1:{port}/api/internal/x", json={})
    assert len(connects) == CONNECT_RETRIES + 1


def _count_connects(monkeypatch) -> list[int]:
    """Count TCP connects made through httpcore's sync backend; backoff sleeps are skipped."""
    connects: list[int] = []
    real_connect = SyncBackend.connect_tcp

    def counting_connect(self, *args, **kwargs):
        connects.append(1)
        return real_connect(self, *args, **kwargs)

    monkeypatch.setattr(SyncBackend, "connect_tcp", counting_connect)
    monkeypatch.setattr(SyncBackend, "sleep", lambda self, seconds: None)
    return connects


def test_the_page_text_presign_retries_a_refused_connect(monkeypatch):
    from knowledge_layer.llamaindex import page_text_store

    monkeypatch.setenv("FRONTEND_INTERNAL_URL", f"http://127.0.0.1:{_closed_port()}")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "tok")
    connects = _count_connects(monkeypatch)
    assert page_text_store.request_slot("d1", "proj_1", page_text_store.PAGES_PART) is None
    assert len(connects) == CONNECT_RETRIES + 1


def test_the_page_text_put_retries_a_refused_connect(monkeypatch):
    from knowledge_layer.llamaindex import page_text_store

    connects = _count_connects(monkeypatch)
    with pytest.raises(httpx.ConnectError):
        page_text_store.put_part(f"http://127.0.0.1:{_closed_port()}/pages.md", b"x", "text/markdown")
    assert len(connects) == CONNECT_RETRIES + 1


def test_the_image_put_retries_a_refused_connect(monkeypatch):
    from knowledge_layer.llamaindex import image_store

    connects = _count_connects(monkeypatch)
    with pytest.raises(httpx.ConnectError):
        image_store.put_raster(f"http://127.0.0.1:{_closed_port()}/0.jpg", b"x")
    assert len(connects) == CONNECT_RETRIES + 1


def test_the_presence_check_retries_a_refused_connect(monkeypatch):
    from knowledge_layer.llamaindex import document_presence

    monkeypatch.setenv("FRONTEND_INTERNAL_URL", f"http://127.0.0.1:{_closed_port()}")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "tok")
    connects = _count_connects(monkeypatch)
    assert document_presence.document_still_exists("d1", "proj_1") is None
    assert len(connects) == CONNECT_RETRIES + 1


def test_a_host_whose_retries_were_spent_fails_fast_until_its_window_passes(monkeypatch):
    """One job makes several fail-open calls; against a host that stays down each
    used to wait out its own retries, and a job outlasted its deadline. The second
    call now fails at once, without a connect, until HOST_DOWN_SECONDS have passed."""
    connects = _count_connects(monkeypatch)
    url = f"http://127.0.0.1:{_closed_port()}/api/internal/x"
    with connect_retrying_client(read_timeout=1.0) as client:
        with pytest.raises(httpx.ConnectError):
            client.get(url)
        spent = len(connects)
        started = time.monotonic()
        with pytest.raises(httpx.ConnectError, match="unreachable moments ago"):
            client.post(url, json={})
        assert time.monotonic() - started < 0.5
        assert len(connects) == spent

        monkeypatch.setattr(connect_retry.time, "monotonic", lambda: time.time() + 10 * connect_retry.HOST_DOWN_SECONDS)
        with pytest.raises(httpx.ConnectError):
            client.get(url)
    assert len(connects) == 2 * spent


def test_an_answer_clears_the_mark(monkeypatch):
    connect_retry._down_until["http://example.test:8080"] = 0.0
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda self, request: httpx.Response(204))
    with connect_retrying_client(read_timeout=1.0) as client:
        assert client.get("http://example.test:8080/").status_code == 204
    assert "http://example.test:8080" not in connect_retry._down_until
