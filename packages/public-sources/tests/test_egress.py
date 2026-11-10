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
from public_sources_testing.network import PlainHttpsForMock


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
                "X-Organization-Id": "org_1",
                "Accept": "text/html",
            },
        )
    assert "authorization" not in seen and "cookie" not in seen and "x-organization-id" not in seen
    assert seen["accept"] == "text/html"


async def test_only_reads_leave():
    source = parse_source(html_source())
    async with guarded_client(source, transport=httpx.MockTransport(lambda r: httpx.Response(200))) as client:
        with pytest.raises(EgressRefused, match="not a read"):
            await client.delete("https://law.example.org/bo.html")


# --- The fixed safety point (build-split S6): every internal destination is refused
# --- after DNS, on the first request and on a redirect, at the address actually dialled.

_REFUSED_AFTER_DNS = {
    "loopback": "127.0.0.1",
    "loopback_v6": "::1",
    "private_10": "10.12.0.7",
    "private_172": "172.20.1.1",
    "private_192": "192.168.0.10",
    "cluster_service_cidr": "10.96.0.1",
    "cluster_pod_cidr": "10.244.3.17",
    "link_local": "169.254.10.10",
    "cloud_metadata_v4": "169.254.169.254",
    "cloud_metadata_v6": "fd00:ec2::254",
    "link_local_v6": "fe80::1",
    "unique_local_v6": "fd12:3456::1",
    "cgnat": "100.64.1.1",
    "unspecified": "0.0.0.0",
    "v4_mapped_private": "::ffff:192.168.1.1",
    "multicast": "239.1.1.1",
    "nat64_well_known": "64:ff9b::a00:1",
    "nat64_local": "64:ff9b:1::a00:1",
    "benchmarking": "198.18.0.1",
    "ietf_protocol": "192.0.0.8",
    "reserved_240": "240.0.0.1",
}


@pytest.mark.parametrize("case", sorted(_REFUSED_AFTER_DNS))
async def test_an_allowed_host_that_resolves_internally_is_refused_before_connecting(case):
    inner = _Recorder()
    backend = PublicOnlyBackend(inner=inner, resolver=await _resolver_to(_REFUSED_AFTER_DNS[case]))
    with pytest.raises(EgressRefused, match="non-public"):
        await backend.connect_tcp("law.example.org", 443)
    assert inner.connected == [], f"{case}: a connection was opened"


async def test_a_redirect_to_an_allowed_host_that_resolves_internally_is_refused_at_that_hop():
    # The host list cannot catch this one: the redirect stays on a listed host,
    # whose DNS now answers with the metadata address. The dial is what refuses.
    source = parse_source(html_source(hosts=["law.example.org", "files.example.org"]))
    answers = {"law.example.org": ["93.184.216.34"], "files.example.org": ["169.254.169.254"]}
    dialled: list[str] = []

    async def resolve(host, port):
        return answers[host]

    class _Answering(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            dialled.append(host)
            return httpcore.AsyncMockStream(
                [b"HTTP/1.1 302 Found\r\nLocation: https://files.example.org/bo.html\r\nContent-Length: 0\r\n\r\n"]
            )

        async def sleep(self, seconds):
            return None

    transport = GuardedTransport(PublicOnlyBackend(inner=_Answering(), resolver=resolve))
    # Plain-text mock streams: no TLS handshake to fake, so the client speaks http to the mock.
    transport._pool._ssl_context = None
    async with guarded_client(source, transport=PlainHttpsForMock(transport)) as client:
        with pytest.raises(EgressRefused, match="169.254.169.254"):
            await client.get("https://law.example.org/bo.html")
    assert dialled == ["93.184.216.34"]


async def test_the_resolved_address_is_the_one_dialled_not_a_second_lookup():
    # Pinning: one resolution decides both the check and the connection, so a
    # name that answers public first and private second cannot slip through.
    answers = iter([["93.184.216.34"], ["10.0.0.5"]])
    inner = _Recorder()

    async def flipping(host, port):
        return next(answers)

    backend = PublicOnlyBackend(inner=inner, resolver=flipping)
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("law.example.org", 443)
    assert inner.connected == ["93.184.216.34"]


async def test_every_checked_address_is_tried_in_order_when_the_first_does_not_answer():
    # An AAAA answered first must not strand a pod that has no IPv6 route.
    tried: list[str] = []

    class _V4Only(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
            tried.append(host)
            if ":" in host:
                raise httpcore.ConnectError("network unreachable")
            return httpcore.AsyncMockStream([])

        async def sleep(self, seconds):
            return None

    backend = PublicOnlyBackend(
        inner=_V4Only(), resolver=await _resolver_to("2a00:1450:4001:80b::200e", "93.184.216.34")
    )
    await backend.connect_tcp("law.example.org", 443)
    assert tried == ["2a00:1450:4001:80b::200e", "93.184.216.34"]


@pytest.mark.parametrize(
    ("url", "allowed"),
    [
        ("https://law.example.org/bo.html", True),
        ("https://law.example.org:443/bo.html", True),
        ("https://law.example.org:8443/bo.html", False),
        ("https://law.example.org:22/", False),
        ("https://user@law.example.org/", False),
        ("http://law.example.org/", False),
    ],
)
def test_a_source_allows_its_hosts_on_https_and_the_default_port_only(url, allowed):
    assert parse_source(html_source()).allows(url) is allowed
