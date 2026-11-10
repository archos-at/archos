"""Without ``sourceRouting``, the RIS adapter's own client is guarded like every public-source fetch.

The routed client goes through ``public_sources.routing``; the unrouted one used
httpx's own transport, which checked each hop's host name and nothing after
DNS. A RIS name that answers a cluster address (DNS rebinding), or a redirect to
a RIS host that does, reached it. Now both clients dial only an address the
guard resolved itself and found public (``public_sources.egress``), and a
refusal is not retried.
"""

from __future__ import annotations

import socket

import httpcore
import pytest
from ris_adapter.client import RisClient
from ris_adapter.client import RisError

DOCUMENT = "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000001/NOR40000001.html"


@pytest.fixture(autouse=True)
def _unrouted(monkeypatch):
    async def off() -> bool:
        return False

    monkeypatch.setattr("ris_adapter.client.routing_enabled", off)


@pytest.mark.parametrize("address", ["10.96.0.10", "127.0.0.1", "169.254.169.254", "100.64.0.1"])
async def test_the_default_client_refuses_a_ris_name_resolving_into_the_cluster_before_connecting(monkeypatch, address):
    dialled: list[str] = []

    def resolve(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]

    async def connect(self, host, port, timeout=None, local_address=None, socket_options=None):  # pragma: no cover
        dialled.append(host)
        raise httpcore.ConnectError("dialled")

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(httpcore.AnyIOBackend, "connect_tcp", connect)
    client = RisClient(max_retries=3)  # no transport: the client the product uses

    with pytest.raises(RisError, match=f"refused.*{address.replace('.', '[.]')}"):
        await client.fetch_document_text(DOCUMENT)
    await client.aclose()
    assert dialled == []


async def test_a_redirect_from_the_default_client_to_a_ris_host_that_resolves_internally_is_refused_at_that_hop(
    monkeypatch,
):
    # The host check cannot catch this one: the redirect stays on a RIS host, whose DNS answers the metadata address.
    # The default client, as the product builds it: only DNS and the socket are scripted.
    addresses = {"www.ris.bka.gv.at": "93.184.216.34", "ris.bka.gv.at": "169.254.169.254"}
    dialled: list[str] = []

    def resolve(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addresses[host], port))]

    async def connect(self, host, port, timeout=None, local_address=None, socket_options=None):
        dialled.append(host)
        return httpcore.AsyncMockStream(
            [b"HTTP/1.1 302 Found\r\nLocation: https://ris.bka.gv.at/x.html\r\nContent-Length: 0\r\n\r\n"]
        )

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(httpcore.AnyIOBackend, "connect_tcp", connect)
    client = RisClient(max_retries=3)

    with pytest.raises(RisError, match="169.254.169.254"):
        await client.fetch_document_text(DOCUMENT)
    await client.aclose()
    assert dialled == ["93.184.216.34"]


async def test_a_lookup_that_fails_is_a_transport_failure_retried_then_a_ris_error(monkeypatch):
    # A DNS blip is no refusal: it is retried like any connect failure and ends as RisError (a 502 at the routes).
    lookups: list[str] = []

    def resolve(host, port, *args, **kwargs):
        lookups.append(host)
        raise socket.gaierror(socket.EAI_AGAIN, "Temporary failure in name resolution")

    async def no_wait(seconds):
        return None

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr("ris_adapter.client.asyncio.sleep", no_wait)
    client = RisClient(max_retries=3)

    with pytest.raises(RisError, match="after 3 attempts"):
        await client.fetch_document_text(DOCUMENT)
    await client.aclose()
    assert lookups == ["www.ris.bka.gv.at"] * 3
