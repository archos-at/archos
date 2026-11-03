"""The transient 402 (credits held by in-flight requests) is retried by the OpenRouter transport."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from agent.common import credit_retry
from agent.common import openrouter

IN_FLIGHT = (
    b'{"error":{"code":402,"message":"would exceed your available credits given your current in-flight requests"}}'
)
EMPTY = b'{"error":{"code":402,"message":"Insufficient credits"}}'
OK = b'{"ok":true}'


def test_only_the_in_flight_402_is_transient():
    assert credit_retry.is_transient_credit_402(402, IN_FLIGHT)
    assert not credit_retry.is_transient_credit_402(402, EMPTY)
    assert not credit_retry.is_transient_credit_402(500, IN_FLIGHT)


def test_delay_doubles(monkeypatch):
    monkeypatch.setattr(credit_retry, "BASE_DELAY_SECONDS", 1.0)
    assert credit_retry.delay_seconds(2) > credit_retry.delay_seconds(0) * 2


class _Sync(httpx.BaseTransport):
    def __init__(self, bodies):
        self.bodies, self.calls = list(bodies), 0

    def handle_request(self, request):
        self.calls += 1
        body = self.bodies.pop(0)
        return httpx.Response(200 if body == OK else 402, content=body, request=request)


class _Async(httpx.AsyncBaseTransport):
    def __init__(self, bodies):
        self.bodies, self.calls = list(bodies), 0

    async def handle_async_request(self, request):
        self.calls += 1
        body = self.bodies.pop(0)
        return httpx.Response(200 if body == OK else 402, content=body, request=request)


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(credit_retry, "BASE_DELAY_SECONDS", 0.0)
    monkeypatch.setenv("PROVIDER_LIMITER", "off")


def _request():
    return httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions", json={"model": "m"})


def _sync_transport(inner):
    return openrouter._PinningTransport(openrouter.ZERO_DATA_RETENTION, inner=inner)


def test_sync_retries_in_flight_then_succeeds():
    inner = _Sync([IN_FLIGHT, IN_FLIGHT, OK])
    assert _sync_transport(inner).handle_request(_request()).status_code == 200
    assert inner.calls == 3


def test_sync_does_not_retry_an_empty_balance():
    inner = _Sync([EMPTY, OK])
    assert _sync_transport(inner).handle_request(_request()).status_code == 402
    assert inner.calls == 1


def test_sync_gives_up_after_the_bound():
    inner = _Sync([IN_FLIGHT] * (credit_retry.MAX_RETRIES + 1))
    response = _sync_transport(inner).handle_request(_request())
    assert response.status_code == 402
    assert inner.calls == credit_retry.MAX_RETRIES + 1


def test_async_retries_in_flight_then_succeeds():
    inner = _Async([IN_FLIGHT, OK])
    transport = openrouter._AsyncPinningTransport(openrouter.ZERO_DATA_RETENTION, inner=inner)
    response = asyncio.run(transport.handle_async_request(_request()))
    assert response.status_code == 200 and inner.calls == 2
