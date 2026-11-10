"""Where a source's requests go: through the sandboxed fetcher, and nowhere else.

A caller (the RIS adapter, a capture, a monitor, ``source-test``) builds
requests as it always did and hands its httpx client the transport
:func:`source_transport` returns. That transport sends each request to the
``public-source-fetcher`` (``PUBLIC_SOURCE_FETCHER_URL``: a Deployment in every
stack, a service in Compose), which makes it from a pod that can reach public
hosts and nothing in the cluster. There is no in-process path: without a
fetcher, a source is refused (ADR-0162 amendment). The guard
(:mod:`public_sources.egress`) runs in the fetcher itself; a test hands in a
transport instead of the network.

The transport refuses a URL off the source's hosts before anything is sent,
and forwards only the headers :data:`public_sources.egress.FORWARDED_HEADERS`
names.
"""

from __future__ import annotations

import os

import httpx
from public_sources.egress import FORWARDED_HEADERS
from public_sources.egress import EgressRefused
from public_sources.egress import attach_credential
from public_sources.egress import strip_headers
from public_sources.source import Source
from public_sources.source import get_source

ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
#: Header the fetcher sets on a refusal, so the caller raises instead of reading a body.
REFUSED_HEADER = "x-public-source-refused"
#: Response headers the fetcher passes back from the source.
RETURNED_HEADERS = ("content-type", "etag", "last-modified")


class _SourceCheck(httpx.AsyncBaseTransport):
    """Refuse a URL off the source's hosts, strip the headers, then delegate."""

    def __init__(self, source, inner: httpx.AsyncBaseTransport, credential: tuple[str, str] | None = None) -> None:
        self.source = source
        self.inner = inner
        self.credential = credential

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not self.source.allows(str(request.url)):
            raise EgressRefused(f"{request.url} is not on a host of source {self.source.id!r}", request=request)
        strip_headers(request.headers)
        attach_credential(request.headers, self.credential)
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()


class FetcherTransport(httpx.AsyncBaseTransport):
    """Sends each request to the sandboxed fetcher instead of the network."""

    def __init__(
        self,
        source_id: str,
        fetcher_url: str,
        inner: httpx.AsyncBaseTransport | None = None,
        *,
        hosts: tuple[str, ...] | None = None,
        credential: tuple[str, str] | None = None,
    ) -> None:
        self.source_id = source_id
        #: A configured (database) source's hosts; the fetcher has no record of it (ADR-0174).
        self.hosts = hosts
        self.credential = credential
        self.endpoint = fetcher_url.rstrip("/") + "/v1/fetch"
        self._client = httpx.AsyncClient(transport=inner, timeout=60.0, trust_env=False)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        payload: dict = {
            "source": self.source_id,
            "method": request.method,
            "url": str(request.url),
            "headers": {k: v for k, v in request.headers.items() if k.lower() in FORWARDED_HEADERS},
            "body": body.decode("utf-8") if body else "",
        }
        if self.hosts is not None:
            payload["hosts"] = list(self.hosts)
        if self.credential is not None:
            payload["credential"] = {"header": self.credential[0], "value": self.credential[1]}
        answer = await self._client.post(self.endpoint, json=payload)
        if REFUSED_HEADER in answer.headers:
            raise EgressRefused(answer.headers[REFUSED_HEADER], request=request)
        headers = {name: answer.headers[name] for name in RETURNED_HEADERS if name in answer.headers}
        return httpx.Response(answer.status_code, headers=headers, content=answer.content, request=request)

    async def aclose(self) -> None:
        await self._client.aclose()


def source_transport(
    source: str | Source,
    *,
    inner: httpx.AsyncBaseTransport | None = None,
    credential: str | None = None,
) -> httpx.AsyncBaseTransport:
    """The transport for a source's requests: always the fetcher; with no fetcher configured, a refusal.

    ``source`` is a repository record's id, or a configured source (ADR-0174)
    parsed with :func:`public_sources.source.parse_inline_source`, whose hosts
    travel with each request because the fetcher holds no record of it.
    ``credential`` is a keyed source's key, set after the strip under the
    header its record names. ``inner`` stands in for the network in tests only.
    """
    record = get_source(source) if isinstance(source, str) else source
    header = None
    if credential is not None:
        if record.credential is None:
            raise EgressRefused(f"source {record.id!r} names no credential header, so it takes no key")
        header = (record.credential.header, record.credential.prefix + credential)
    fetcher_url = os.environ.get(ENV_FETCHER_URL, "").strip()
    if fetcher_url:
        hosts = None if isinstance(source, str) else tuple(record.hosts)
        fetcher = FetcherTransport(record.id, fetcher_url, inner=inner, hosts=hosts, credential=header)
        return _SourceCheck(record, fetcher, credential=header)
    if inner is None:
        raise EgressRefused(
            f"no public-source fetcher is configured ({ENV_FETCHER_URL}): source {record.id!r} is read only through it"
        )
    return _SourceCheck(record, inner, credential=header)
