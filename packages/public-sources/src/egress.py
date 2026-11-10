"""The guard every fetch of a public source goes through.

Three checks, each closing a different way out:

1. **The host list, at every hop.** A request (the first, or one a redirect
   produced) whose URL is not https on one of the source's hosts is refused
   before it is sent. A source that reflects a query parameter into
   ``Location`` cannot walk the fetch to another host.
2. **Public addresses only, after DNS.** The connection is opened to an address
   the guard resolved itself and found global: no private, loopback,
   link-local, carrier-grade NAT, multicast or reserved range. The TCP
   connection goes to that checked address, so a name that answers differently
   the second time (DNS rebinding) cannot reach the cluster; TLS still verifies
   the certificate against the host name.
3. **What leaves.** GET (and a SPARQL POST to a configured endpoint) with the
   headers named in :data:`FORWARDED_HEADERS` and nothing else: no cookie, no
   authorization, no tenant header. A ``public_only`` source receives the
   operation's parameters and no more.

The fetcher Deployment (``deploy/pulumi/src/app/public-source-fetcher.ts``)
adds the layer that holds while code is wrong: its NetworkPolicy refuses every
private destination, so even a bug here cannot reach an in-cluster service.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Iterable
from typing import Any

import httpcore
import httpx

#: Request headers a fetch may carry. Everything else is dropped.
FORWARDED_HEADERS = frozenset({"accept", "accept-language", "if-none-match", "if-modified-since", "content-type"})
#: The largest body one fetch may bring back.
MAX_BODY_BYTES = 20 * 1024 * 1024
USER_AGENT = "public-sources/0.1 (+https://data.gv.at; open government data reader)"


class EgressRefused(httpx.TransportError):
    """A fetch the guard refused: a host off the list, or an address that is not public."""


#: Prefixes that translate to IPv4 behind a gateway (RFC 6052 NAT64). Python counts the
#: well-known one as global, but ``64:ff9b::a00:1`` reaches 10.0.0.1 wherever NAT64 runs.
_TRANSLATED_V6 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))


def is_public_address(address: str) -> bool:
    """Whether ``address`` is a globally routable unicast address."""
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
    """Opens TCP connections only to public addresses it resolved itself."""

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
        addresses = await self._resolver(host, port)
        if not addresses:
            raise EgressRefused(f"{host} does not resolve")
        private = [address for address in addresses if not is_public_address(address)]
        if private:
            raise EgressRefused(f"{host} resolves to a non-public address ({private[0]}); refused")
        return await self._first_that_answers(addresses, port, timeout, local_address, socket_options)

    async def _first_that_answers(self, addresses, port, timeout, local_address, socket_options):
        """Each checked address in resolver order (an AAAA first must not strand an IPv4-only pod)."""
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
    """httpx's own transport, its connection pool built on :class:`PublicOnlyBackend`.

    httpx does not take a network backend, so the pool it built is replaced by
    an identical one that does; ``test_egress.py`` holds that a loopback answer
    is refused through this class, so an httpx upgrade that renames the pool
    fails a test instead of silently dropping the check.
    """

    def __init__(self, backend: httpcore.AsyncNetworkBackend | None = None) -> None:
        super().__init__(http2=False, retries=0)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=10,
            network_backend=backend or PublicOnlyBackend(),
        )


def strip_headers(headers: httpx.Headers) -> None:
    """Remove every header a fetch may not carry (in place)."""
    for name in list(headers.keys()):
        if name.lower() not in FORWARDED_HEADERS and name.lower() not in {"host", "user-agent", "content-length"}:
            del headers[name]


def attach_credential(headers: httpx.Headers, credential: tuple[str, str] | None) -> None:
    """Set a keyed source's key, after the strip (ADR-0174). ``credential`` is ``(header, value)``."""
    if credential is not None:
        headers[credential[0]] = credential[1]


def guarded_client(
    source,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 30.0,
    credential: tuple[str, str] | None = None,
) -> httpx.AsyncClient:
    """A client that may reach ``source``'s hosts and nothing else.

    ``transport`` replaces the guarded one only in tests, which record the
    exchange instead of making it; the host check and the header strip still run.
    ``credential`` (a header and its value) is set on every request after the
    strip, so it goes to the source's hosts and to nothing else.
    """

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
