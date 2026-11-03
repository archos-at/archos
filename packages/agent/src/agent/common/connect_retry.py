"""The HTTP client the ingest worker uses for the BFF and the object store.

A restart of the BFF or the store, or a blip in the path to it, refuses or drops a connect for
a few seconds. Each call that met it lost its piece for good: no page text, no
image, no permit record, a thumbnail never uploaded, a document treated as
present. This client retries a failed CONNECT and nothing else.

Why connect only: httpcore repeats a connect that raised ``ConnectError`` or
``ConnectTimeout`` before one byte of the request left the process, so the
server never saw it. That is safe for any method, the POST that mints a
presigned slot included. A request the server may have received is never sent
twice here, so a write cannot land twice.

The same policy as the download in ``apps/agent-host`` (``DeferredObjectDownload``),
which is where ``CONNECT_RETRIES`` was measured.

Why a host is then marked down: one ingest job makes several of these calls,
each fail-open. Against a host that stays unreachable, every one would wait out
its own ~15 s of retries, and a job of a few calls outlasts its deadline (CI,
``test_an_unreachable_bff_keeps_the_new_version``). So a host whose retries are
spent answers every call for :data:`HOST_DOWN_SECONDS` with an immediate
``ConnectError``: a blip is retried, a long outage costs one window per host,
not one per call. The map holds hosts only, never tenant data, and as many
entries as the worker has upstreams.
"""

from __future__ import annotations

import threading
import time

import httpx

#: Connect attempts after the first, backing off 0, 0.5, 1, 2, 4, 8 s: about
#: 15 s in all, longer than the BFF's restart and database blips PostHog Logs
#: has shown.
CONNECT_RETRIES = 6

#: Per connect attempt. Each of the retries gets its own bound, so a store that
#: drops SYNs cannot hold a worker for the whole read budget times seven.
CONNECT_TIMEOUT_SECONDS = 5.0


#: How long a host whose connect retries were all spent fails fast, like the
#: 30 s negative cache of ``llm_credentials``.
HOST_DOWN_SECONDS = 30.0

_down_until: dict[str, float] = {}
_down_lock = threading.Lock()


def _host_key(request: httpx.Request) -> str:
    return f"{request.url.scheme}://{request.url.host}:{request.url.port}"


class _MarksHostDown(httpx.HTTPTransport):
    """The retrying transport, which fails at once for a host whose retries were just spent."""

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
    """A client whose connect is retried; redirects are not followed.

    A presigned URL or the internal route must not be sent somewhere ``Location``
    names, so a 3xx stays an answer, as it was with ``httpx.post``.
    """
    return httpx.Client(
        transport=_MarksHostDown(retries=CONNECT_RETRIES),
        timeout=httpx.Timeout(read_timeout, connect=CONNECT_TIMEOUT_SECONDS),
        follow_redirects=False,
    )
