from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Iterable
from typing import Any

import httpcore
import httpx

FORWARDED_HEADERS = frozenset({"accept", "accept-language", "if-none-match", "if-modified-since", "content-type"})
MAX_BODY_BYTES = 20 * 1024 * 1024
USER_AGENT = "public-sources/0.1 (+https://data.gv.at; open government data reader)"


class EgressRefused(httpx.TransportError):
    ...


_TRANSLATED_V6 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif any(ip in prefix for prefix in _TRANSLATED_V6):
            return False
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


async def _resolve(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


class PublicOnlyBackend(httpcore.AsyncNetworkBackend):

    def __init__(self, inner: httpcore.AsyncNetworkBackend | None = None, resolver=_resolve) -> None:
        self._inner = inner or httpcore.AnyIOBackend()
        self._resolver = resolver

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            addresses = await self._resolver(host, port)
        except OSError as exc:  # socket.gaierror (EAI_AGAIN, EAI_NONAME): a lookup failed, nothing was refused
            raise httpcore.ConnectError(f"{host} could not be resolved: {exc}") from exc
        if not addresses:
            raise EgressRefused(f"{host} does not resolve")
        private = [address for address in addresses if not is_public_address(address)]
        if private:
            raise EgressRefused(f"{host} resolves to a non-public address ({private[0]}); refused")
        return await self._first_that_answers(addresses, port, timeout, local_address, socket_options)

    async def _first_that_answers(self, addresses, port, timeout, local_address, socket_options):
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._inner.connect_tcp(
                    address, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except httpcore.ConnectError as exc:
                last_error = exc
        assert last_error is not None
        raise last_error

    async def connect_unix_socket(self, path: str, timeout: float | None = None, socket_options=None):
        raise EgressRefused("unix sockets are not a public source")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class GuardedTransport(httpx.AsyncHTTPTransport):

    def __init__(self, backend: httpcore.AsyncNetworkBackend | None = None) -> None:
        super().__init__(http2=False, retries=0)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=10,
            network_backend=backend or PublicOnlyBackend(),
        )


def strip_headers(headers: httpx.Headers) -> None:
    for name in list(headers.keys()):
        if name.lower() not in FORWARDED_HEADERS and name.lower() not in {"host", "user-agent", "content-length"}:
            del headers[name]


def attach_credential(headers: httpx.Headers, credential: tuple[str, str] | None) -> None:
    if credential is not None:
        headers[credential[0]] = credential[1]


def guarded_client(
    source,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 30.0,
    credential: tuple[str, str] | None = None,
) -> httpx.AsyncClient:

    async def _check(request: httpx.Request) -> None:
        url = str(request.url)
        if not source.allows(url):
            raise EgressRefused(f"{url} is not on a host of source {source.id!r}", request=request)
        if request.method not in {"GET", "POST"}:
            raise EgressRefused(f"{request.method} is not a read", request=request)
        strip_headers(request.headers)
        attach_credential(request.headers, credential)

    return httpx.AsyncClient(
        transport=transport or GuardedTransport(),
        timeout=timeout,
        follow_redirects=True,
        max_redirects=5,
        trust_env=False,
        headers={"User-Agent": USER_AGENT},
        event_hooks={"request": [_check]},
    )
