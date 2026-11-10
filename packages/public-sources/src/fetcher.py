"""The sandboxed fetcher: the one process that talks to public sources.

``POST /v1/fetch`` takes ``{source, method, url, headers, body}`` from a caller
in the cluster (:class:`public_sources.routing.FetcherTransport`) and makes
that request through :func:`public_sources.egress.guarded_client` of the named
source. It answers with the source's status, body and the headers in
:data:`public_sources.routing.RETURNED_HEADERS`; a refused request is a 403
carrying ``x-public-source-refused`` with the reason, a source that did not
answer a 502.

It holds no secret and no tenant data, and its Deployment
(``deploy/pulumi/src/app/public-source-fetcher.ts``) can reach public addresses
and DNS only. Logs carry the source, host, path, status and size, never the
query string: a search term is derived from somebody's question.

Run: ``python -m public_sources.fetcher`` (``PORT``, default 8095).
"""

from __future__ import annotations

import contextlib
import logging
import os
from urllib.parse import urlparse

import httpx
from public_sources.egress import MAX_BODY_BYTES
from public_sources.egress import EgressRefused
from public_sources.egress import guarded_client
from public_sources.routing import REFUSED_HEADER
from public_sources.routing import RETURNED_HEADERS
from public_sources.source import SourceError
from public_sources.source import get_source
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.responses import Response
from starlette.routing import Route

logger = logging.getLogger("public_sources.fetcher")

DEFAULT_PORT = 8095


def _refused(reason: str) -> Response:
    return Response(reason, status_code=403, headers={REFUSED_HEADER: reason[:300]})


def make_app(*, transport: httpx.AsyncBaseTransport | None = None) -> Starlette:
    """The fetcher app. ``transport`` replaces the guarded network in tests only."""
    clients: dict[str, httpx.AsyncClient] = {}

    def client_for(source) -> httpx.AsyncClient:
        if source.id not in clients:
            clients[source.id] = guarded_client(source, transport=transport)
        return clients[source.id]

    async def fetch(request: Request) -> Response:
        try:
            payload = await request.json()
            source = get_source(str(payload["source"]))
        except (ValueError, KeyError, TypeError, SourceError) as exc:
            return _refused(f"bad request: {exc}")
        method = str(payload.get("method", "GET")).upper()
        url = str(payload.get("url", ""))
        if method not in {"GET", "POST"}:
            return _refused(f"{method} is not a read")
        if not source.allows(url):
            return _refused(f"{urlparse(url).hostname} is not a host of source {source.id}")
        headers = payload.get("headers") if isinstance(payload.get("headers"), dict) else {}
        body = str(payload.get("body") or "").encode("utf-8")
        try:
            upstream = await _send(client_for(source), method, url, headers, body)
        except EgressRefused as exc:
            logger.warning("refused source=%s host=%s: %s", source.id, urlparse(url).hostname, exc)
            return _refused(str(exc))
        except (httpx.HTTPError, _TooLarge) as exc:
            logger.warning("unavailable source=%s host=%s: %s", source.id, urlparse(url).hostname, exc)
            return Response(f"source unavailable: {exc}", status_code=502)
        status, content, upstream_headers = upstream
        parsed = urlparse(url)
        logger.info(
            "fetched source=%s host=%s path=%s status=%s bytes=%s",
            source.id,
            parsed.hostname,
            parsed.path,
            status,
            len(content),
        )
        returned = {name: upstream_headers[name] for name in RETURNED_HEADERS if name in upstream_headers}
        return Response(content, status_code=status, headers=returned)

    async def health(_: Request) -> Response:
        return JSONResponse({"ok": True})

    @contextlib.asynccontextmanager
    async def lifespan(_: Starlette):
        yield
        for client in clients.values():
            await client.aclose()

    return Starlette(
        routes=[Route("/v1/fetch", fetch, methods=["POST"]), Route("/healthz", health, methods=["GET"])],
        lifespan=lifespan,
    )


class _TooLarge(Exception):
    pass


async def _send(client: httpx.AsyncClient, method: str, url: str, headers: dict, body: bytes):
    request = client.build_request(method, url, headers=headers, content=body or None)
    response = await client.send(request, stream=True)
    try:
        return response.status_code, await _bounded_body(response), response.headers
    finally:
        await response.aclose()


async def _bounded_body(response: httpx.Response) -> bytes:
    """The body, refused past :data:`MAX_BODY_BYTES` while it streams rather than after."""
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise _TooLarge(f"body exceeds {MAX_BODY_BYTES} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


def main() -> None:  # pragma: no cover - process entry point
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", DEFAULT_PORT)), access_log=False)


if __name__ == "__main__":  # pragma: no cover
    main()
