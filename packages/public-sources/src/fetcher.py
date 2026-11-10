"""The sandboxed fetcher: the one process that talks to public sources.

``POST /v1/fetch`` takes ``{source, method, url, headers, body}`` from a caller
in the cluster (:class:`public_sources.routing.FetcherTransport`) and makes
that request through :func:`public_sources.egress.guarded_client` of the named
source. It answers with the source's status, body and the headers in
:data:`public_sources.routing.RETURNED_HEADERS`; a refused request is a 403
carrying ``x-public-source-refused`` with the reason, a source that did not
answer a 502.

It keeps no secret and no tenant data: a keyed source's key arrives with the
request (``credential``), is set after the strip on that one request only, is
never logged and never kept on a client another request reuses. Its Deployment
(``deploy/pulumi/src/app/public-source-fetcher.ts``) can reach public addresses
and DNS only. Logs carry the source, host, path, status and size, never the
query string: a search term is derived from somebody's question.

``POST /v1/extract`` takes a PDF's bytes and answers its text
(:mod:`public_sources.pdf`): a third party's file is parsed here, in the pod
with no secret and no way into the cluster, and never in a backend pod.

Run: ``python -m public_sources.fetcher`` (``PORT``, default 8095).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from public_sources.egress import MAX_BODY_BYTES
from public_sources.egress import EgressRefused
from public_sources.egress import guarded_client
from public_sources.routing import REFUSED_HEADER
from public_sources.routing import RETURNED_HEADERS
from public_sources.source import _HOST_RE
from public_sources.source import REFUSED_CREDENTIAL_HEADERS
from public_sources.source import SourceError
from public_sources.source import get_source
from public_sources.source import url_on_hosts
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.responses import Response
from starlette.routing import Route

logger = logging.getLogger("public_sources.fetcher")

DEFAULT_PORT = 8095
_HEADER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,40}$")


def _refused(reason: str) -> Response:
    return Response(reason, status_code=403, headers={REFUSED_HEADER: reason[:300]})


def make_app(*, transport: httpx.AsyncBaseTransport | None = None) -> Starlette:
    """The fetcher app. ``transport`` replaces the guarded network in tests only."""
    clients: dict[str, httpx.AsyncClient] = {}

    def client_for(source) -> httpx.AsyncClient:
        key = f"{source.id}|{','.join(source.hosts)}"
        if key not in clients:
            clients[key] = guarded_client(source, transport=transport)
        return clients[key]

    async def fetch(request: Request) -> Response:
        try:
            payload = await request.json()
            source = _source_of(payload)
        except (ValueError, KeyError, TypeError, SourceError) as exc:
            return _refused(f"bad request: {exc}")
        credential = _credential_of(payload)
        method = str(payload.get("method", "GET")).upper()
        url = str(payload.get("url", ""))
        if method not in {"GET", "POST"}:
            return _refused(f"{method} is not a read")
        if not source.allows(url):
            return _refused(f"{urlparse(url).hostname} is not a host of source {source.id}")
        headers = payload.get("headers") if isinstance(payload.get("headers"), dict) else {}
        body = str(payload.get("body") or "").encode("utf-8")
        try:
            upstream = await _send_for(source, credential, client_for, transport, (method, url, headers, body))
        except EgressRefused as exc:
            logger.warning("refused source=%s host=%s: %s", source.id, urlparse(url).hostname, exc)
            return _refused(str(exc))
        except (httpx.HTTPError, _TooLarge) as exc:
            logger.warning("unavailable source=%s host=%s: %s", source.id, urlparse(url).hostname, exc)
            return Response(f"source unavailable: {exc}", status_code=502)
        status, content, upstream_headers = upstream
        _log_fetched(source.id, url, status, len(content))
        returned = {name: upstream_headers[name] for name in RETURNED_HEADERS if name in upstream_headers}
        return Response(content, status_code=status, headers=returned)

    async def health(_: Request) -> Response:
        return JSONResponse({"ok": True})

    async def extract(request: Request) -> Response:
        return await _extract(request)

    @contextlib.asynccontextmanager
    async def lifespan(_: Starlette):
        yield
        for client in clients.values():
            await client.aclose()

    return Starlette(
        routes=[
            Route("/v1/fetch", fetch, methods=["POST"]),
            Route("/v1/extract", extract, methods=["POST"]),
            Route("/healthz", health, methods=["GET"]),
        ],
        lifespan=lifespan,
    )


class _TooLarge(Exception):
    pass


async def _extract(request: Request) -> Response:
    """``POST /v1/extract``: a PDF's text, parsed here, where a hostile file reaches nothing.

    The body is the PDF (at most the egress ceiling), ``max_pages`` a query
    parameter. Answers ``{pages, page_count, title}``, or a 422
    ``{code, message}`` with :class:`public_sources.pdf.PdfError`'s code. The
    parse runs in a child process with its deadline, memory ceiling and bare
    environment (:func:`public_sources.pdf.parse_pdf`). Logs carry the size and
    the outcome, never the text.
    """
    from public_sources.pdf import MAX_PDF_PAGES
    from public_sources.pdf import PdfError
    from public_sources.pdf import parse_pdf

    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return JSONResponse(
                {"code": "body_too_large", "message": f"the PDF is larger than {MAX_BODY_BYTES} bytes"}, 422
            )
        chunks.append(chunk)
    try:
        max_pages = min(max(int(request.query_params.get("max_pages", MAX_PDF_PAGES)), 1), MAX_PDF_PAGES)
    except ValueError:
        max_pages = MAX_PDF_PAGES
    try:
        read = await asyncio.to_thread(parse_pdf, b"".join(chunks), max_pages=max_pages)
    except PdfError as exc:
        logger.info("extract refused bytes=%s code=%s", size, exc.code)
        return JSONResponse({"code": exc.code, "message": str(exc)}, status_code=422)
    logger.info("extracted bytes=%s pages=%s of=%s", size, len(read.pages), read.page_count)
    return JSONResponse({"pages": list(read.pages), "page_count": read.page_count, "title": read.title})


async def _send_for(source, credential, client_for, transport, request: tuple[str, str, dict, bytes]):
    """Send through the source's shared client, or, with a key, through a client of this request alone."""
    method, url, headers, body = request
    if credential is None:
        return await _send(client_for(source), method, url, headers, body)
    async with guarded_client(source, transport=transport, credential=credential) as keyed:
        return await _send(keyed, method, url, headers, body)


def _log_fetched(source_id: str, url: str, status: int, size: int) -> None:
    """Source, host, path, status and size: never the query string, which can come from a question."""
    parsed = urlparse(url)
    logger.info(
        "fetched source=%s host=%s path=%s status=%s bytes=%s", source_id, parsed.hostname, parsed.path, status, size
    )


@dataclass(frozen=True)
class _ConfiguredSource:
    """A source configured in the database (ADR-0174): its id and hosts, as the caller sent them.

    The fetcher holds no record of it. What it still holds on its own: public
    addresses only, GET or POST, the header strip, and the hosts at every hop.
    """

    id: str
    hosts: tuple[str, ...]

    def allows(self, url: str) -> bool:
        return url_on_hosts(url, self.hosts)


def _source_of(payload: dict):
    """The repository record named, or a configured source's hosts; never a repository id with other hosts."""
    source_id = str(payload["source"])
    hosts = payload.get("hosts")
    if hosts is None:
        return get_source(source_id)
    if not isinstance(hosts, list) or not hosts or not all(isinstance(h, str) and _HOST_RE.fullmatch(h) for h in hosts):
        raise ValueError("hosts are exact lower-case DNS names")
    try:
        get_source(source_id)
    except SourceError:
        return _ConfiguredSource(id=source_id, hosts=tuple(hosts))
    raise SourceError(f"{source_id} is a repository record; its hosts are the record's")


def _credential_of(payload: dict) -> tuple[str, str] | None:
    credential = payload.get("credential")
    if not isinstance(credential, dict):
        return None
    header, value = str(credential.get("header", "")), str(credential.get("value", ""))
    if not _HEADER_RE.fullmatch(header) or not value or "\n" in value or "\r" in value:
        return None
    if header.lower() in REFUSED_CREDENTIAL_HEADERS or header.lower().startswith(("x-forwarded-", "proxy-")):
        return None
    return header, value


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
