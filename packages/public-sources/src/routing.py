"""Where a source's requests go: through the sandboxed fetcher, or through the guard in process.

A caller (the RIS adapter, a monitor, ``source-test``) builds requests as it
always did and hands its httpx client the transport :func:`source_transport`
returns. With ``PUBLIC_SOURCE_FETCHER_URL`` set, that transport sends each
request to the ``public-source-fetcher`` Deployment, which makes it from a pod
that can reach public hosts and nothing in the cluster. Without it (local
development, a test), the same guard runs in this process.

Both refuse a URL off the source's hosts before anything is sent, and both
forward only the headers :data:`public_sources.egress.FORWARDED_HEADERS` names.
"""

from __future__ import annotations

import os

import httpx
from public_sources.egress import FORWARDED_HEADERS
from public_sources.egress import EgressRefused
from public_sources.egress import GuardedTransport
from public_sources.egress import strip_headers
from public_sources.source import get_source

ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
#: Header the fetcher sets on a refusal, so the caller raises instead of reading a body.
REFUSED_HEADER = "x-public-source-refused"
#: Response headers the fetcher passes back from the source.
RETURNED_HEADERS = ("content-type", "etag", "last-modified")


class _SourceCheck(httpx.AsyncBaseTransport):
    """Refuse a URL off the source's hosts, strip the headers, then delegate."""

    def __init__(self, source, inner: httpx.AsyncBaseTransport) -> None:
        self.source = source
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not self.source.allows(str(request.url)):
            raise EgressRefused(f"{request.url} is not on a host of source {self.source.id!r}", request=request)
        strip_headers(request.headers)
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()


class FetcherTransport(httpx.AsyncBaseTransport):
    """Sends each request to the sandboxed fetcher instead of the network."""

    def __init__(self, source_id: str, fetcher_url: str, inner: httpx.AsyncBaseTransport | None = None) -> None:
        self.source_id = source_id
        self.endpoint = fetcher_url.rstrip("/") + "/v1/fetch"
        self._client = httpx.AsyncClient(transport=inner, timeout=60.0, trust_env=False)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        payload = {
            "source": self.source_id,
            "method": request.method,
            "url": str(request.url),
            "headers": {k: v for k, v in request.headers.items() if k.lower() in FORWARDED_HEADERS},
            "body": body.decode("utf-8") if body else "",
        }
        answer = await self._client.post(self.endpoint, json=payload)
        if REFUSED_HEADER in answer.headers:
            raise EgressRefused(answer.headers[REFUSED_HEADER], request=request)
        headers = {name: answer.headers[name] for name in RETURNED_HEADERS if name in answer.headers}
        return httpx.Response(answer.status_code, headers=headers, content=answer.content, request=request)

    async def aclose(self) -> None:
        await self._client.aclose()


def source_transport(source_id: str, *, inner: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncBaseTransport:
    """The transport for ``source_id``'s requests: the fetcher when one is configured, else the guard here.

    ``inner`` stands in for the network in tests only.
    """
    source = get_source(source_id)
    fetcher_url = os.environ.get(ENV_FETCHER_URL, "").strip()
    if fetcher_url:
        return _SourceCheck(source, FetcherTransport(source_id, fetcher_url, inner=inner))
    return _SourceCheck(source, inner or GuardedTransport())
