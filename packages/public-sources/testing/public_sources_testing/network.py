from __future__ import annotations

import httpcore
import httpx
from public_sources.egress import GuardedTransport
from public_sources.egress import PublicOnlyBackend


class PlainHttpsForMock(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.url = request.url.copy_with(scheme="http", port=443)
        return await self.inner.handle_async_request(request)


def scripted_network(addresses: dict[str, list[str]], answer: bytes, dialled: list[str]) -> httpx.AsyncBaseTransport:

    async def resolve(host: str, port: int) -> list[str]:
        return addresses[host]

    class _Answering(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            dialled.append(host)
            return httpcore.AsyncMockStream([answer])

        async def sleep(self, seconds):
            return None

    transport = GuardedTransport(PublicOnlyBackend(inner=_Answering(), resolver=resolve))
    transport._pool._ssl_context = None
    return PlainHttpsForMock(transport)
