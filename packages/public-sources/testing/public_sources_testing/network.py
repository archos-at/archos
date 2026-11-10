"""A network for tests that must go through the real guard: DNS answered by a table, sockets by recorded bytes."""

from __future__ import annotations

import httpcore
import httpx
from public_sources.egress import GuardedTransport
from public_sources.egress import PublicOnlyBackend


class PlainHttpsForMock(httpx.AsyncBaseTransport):
    """Hands the guarded transport an http URL so the mock stream needs no TLS; the host is unchanged."""

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.url = request.url.copy_with(scheme="http", port=443)
        return await self.inner.handle_async_request(request)


def scripted_network(addresses: dict[str, list[str]], answer: bytes, dialled: list[str]) -> httpx.AsyncBaseTransport:
    """The guarded transport over a resolver of ``addresses`` and sockets that each answer ``answer``.

    Every address the guard dials is appended to ``dialled``, so a test shows
    which hop was refused before a connection was opened.
    """

    async def resolve(host: str, port: int) -> list[str]:
        return addresses[host]

    class _Answering(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            dialled.append(host)
            return httpcore.AsyncMockStream([answer])

        async def sleep(self, seconds):
            return None

    transport = GuardedTransport(PublicOnlyBackend(inner=_Answering(), resolver=resolve))
    # Plain-text mock streams: no TLS handshake to fake, so the client speaks http to the mock.
    transport._pool._ssl_context = None
    return PlainHttpsForMock(transport)
