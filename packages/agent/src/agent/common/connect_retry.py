from __future__ import annotations

import threading
import time

import httpx

CONNECT_RETRIES = 6

CONNECT_TIMEOUT_SECONDS = 5.0


HOST_DOWN_SECONDS = 30.0

_down_until: dict[str, float] = {}
_down_lock = threading.Lock()


def _host_key(request: httpx.Request) -> str:
    return f"{request.url.scheme}://{request.url.host}:{request.url.port}"


class _MarksHostDown(httpx.HTTPTransport):

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = _host_key(request)
        with _down_lock:
            down_until = _down_until.get(host, 0.0)
        if time.monotonic() < down_until:
            raise httpx.ConnectError(f"{host} was unreachable moments ago; not retrying yet", request=request)
        try:
            response = super().handle_request(request)
        except httpx.ConnectError, httpx.ConnectTimeout:
            with _down_lock:
                _down_until[host] = time.monotonic() + HOST_DOWN_SECONDS
            raise
        with _down_lock:
            _down_until.pop(host, None)
        return response


def connect_retrying_client(*, read_timeout: float) -> httpx.Client:
    return httpx.Client(
        transport=_MarksHostDown(retries=CONNECT_RETRIES),
        timeout=httpx.Timeout(read_timeout, connect=CONNECT_TIMEOUT_SECONDS),
        follow_redirects=False,
    )
