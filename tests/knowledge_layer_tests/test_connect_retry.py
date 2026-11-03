"""The connect-retrying client the ingest worker uses for the BFF and the object store."""

from __future__ import annotations

import socket

import httpx
import pytest
from httpcore._backends.sync import SyncBackend

from agent.common.connect_retry import CONNECT_RETRIES
from agent.common.connect_retry import CONNECT_TIMEOUT_SECONDS
from agent.common.connect_retry import connect_retrying_client


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
