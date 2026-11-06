"""The guard: hosts at every hop, public addresses after DNS, only the headers that may leave."""

from __future__ import annotations

import httpcore
import httpx
import pytest
from public_sources.egress import EgressRefused
from public_sources.egress import GuardedTransport
from public_sources.egress import PublicOnlyBackend
from public_sources.egress import guarded_client
from public_sources.egress import is_public_address
from public_sources.source import parse_source
from public_sources_testing import html_source


@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1",
        "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1",
    ],
)  # fmt: skip
def test_cluster_metadata_and_private_addresses_are_not_public(address):
    assert not is_public_address(address)


@pytest.mark.parametrize("address", ["1.1.1.1", "185.177.0.10", "2a00:1450:4001:80b::200e"])
def test_public_addresses_are(address):
    assert is_public_address(address)


async def _resolver_to(*addresses):
    async def resolve(host, port):
        return list(addresses)

    return resolve


class _Recorder(httpcore.AsyncNetworkBackend):
    def __init__(self):
        self.connected: list[str] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.connected.append(host)
        raise httpcore.ConnectError("recorded, not connected")

    async def sleep(self, seconds):
        return None


async def test_a_name_resolving_into_the_cluster_is_refused_before_connecting():
    inner = _Recorder()
    backend = PublicOnlyBackend(inner=inner, resolver=await _resolver_to("93.184.216.34", "10.96.0.10"))
    with pytest.raises(EgressRefused, match="non-public"):
        await backend.connect_tcp("law.example.org", 443)
    assert inner.connected == []


async def test_the_connection_goes_to_the_address_the_guard_checked():
    inner = _Recorder()
    backend = PublicOnlyBackend(inner=inner, resolver=await _resolver_to("93.184.216.34"))
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("law.example.org", 443)
    assert inner.connected == ["93.184.216.34"]


async def test_the_guarded_transport_uses_the_public_only_backend():
    # httpx takes no network backend, so GuardedTransport replaces its pool. If an
    # httpx upgrade renames the pool, this request would connect to loopback.
    backend = PublicOnlyBackend(resolver=await _resolver_to("127.0.0.1"))
    async with httpx.AsyncClient(transport=GuardedTransport(backend)) as client:
        with pytest.raises(EgressRefused, match="non-public"):
            await client.get("https://law.example.org/")


async def test_a_redirect_off_the_hosts_is_refused_at_the_hop():
    source = parse_source(html_source())
    sent: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://10.0.0.5/admin"})

    async with guarded_client(source, transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(EgressRefused, match="not on a host"):
            await client.get("https://law.example.org/bo.html")
    assert sent == ["https://law.example.org/bo.html"]


async def test_only_the_named_headers_leave():
    source = parse_source(html_source())
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, text="ok")

    async with guarded_client(source, transport=httpx.MockTransport(handler)) as client:
        await client.get(
            "https://law.example.org/bo.html",
            headers={
                "Authorization": "Bearer x",
                "Cookie": "a=b",
                "X-Grid-Organization-Id": "org_1",
                "Accept": "text/html",
            },
        )
    assert "authorization" not in seen and "cookie" not in seen and "x-grid-organization-id" not in seen
    assert seen["accept"] == "text/html"


async def test_only_reads_leave():
    source = parse_source(html_source())
    async with guarded_client(source, transport=httpx.MockTransport(lambda r: httpx.Response(200))) as client:
        with pytest.raises(EgressRefused, match="not a read"):
            await client.delete("https://law.example.org/bo.html")
