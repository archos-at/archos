"""Capture one page of a configured public source, for a citation (ADR-0170).

An operator's agent onboarding a country cites pages, and the BFF stores what
each citation is checked against (KC-6). The BFF cannot fetch: the sandboxed
public-source fetcher admits the backend roles only (ADR-0162, its
NetworkPolicy). So the BFF asks here, and this route makes the request through
:func:`public_sources.capture.capture_page`, which uses the same transport every
source reader uses: the source's hosts checked at every redirect, a public
address, GET only. It answers the bytes' sha256 and size and the page's text
(a PDF's pages joined by a form feed, with ``pages`` and a ``note`` when a scan
has no text layer); the BFF stores them in the change request's capture. A refusal
the reader names (a host off the source or no public address, ``egress_refused``;
a body past the ceiling; a PDF behind a password, broken, too long or too slow)
answers the problem's ``code`` beside its ``detail``.

Public pages only, never a tenant's content, and nothing is kept here.
Internal-token guarded like every other service-to-service route: reached from
the BFF, never from a browser.
"""

import logging
from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pydantic import Field

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


class CaptureRequest(BaseModel):
    source: str = Field(
        ..., pattern=r"^[a-z]{2}-[a-z0-9-]{1,60}$", description="The configured source's id, e.g. at-ris."
    )
    url: str = Field(..., min_length=8, max_length=2000)
    #: A source configured in the database (ADR-0174), whole; absent for a repository record.
    config: dict[str, Any] | None = None
    #: A keyed source's key, held write-only by the BFF and handed over for this one fetch.
    credential: str | None = Field(default=None, min_length=1, max_length=4000)


class SourceRequest(BaseModel):
    """A source configured in the database, as the BFF hands it over (ADR-0174)."""

    config: dict[str, Any]
    credential: str | None = Field(default=None, min_length=1, max_length=4000)


class Seen(BaseModel):
    etag: str = ""
    sha256: str = ""
    version: str = ""
    termsSha256: str = ""


class ProbeRequest(SourceRequest):
    previous: Seen = Field(default_factory=Seen)


def _configured(config: dict[str, Any]):
    from public_sources.source import SourceError
    from public_sources.source import parse_inline_source

    try:
        return parse_inline_source(config)
    except SourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def capture_public_source_page(
    body: CaptureRequest, _: None = Depends(_require_internal_token)
) -> dict | JSONResponse:
    """Return ``{url, finalUrl, contentType, sha256, bytes, text, pages, note, retrievedAt}`` for one page."""
    from public_sources.capture import CaptureError
    from public_sources.capture import capture_page
    from public_sources.egress import EgressRefused
    from public_sources.source import SourceError

    source = _configured(body.config) if body.config is not None else body.source
    if body.config is not None and body.config.get("id") != body.source:
        raise HTTPException(status_code=422, detail="the configuration is not of the named source")
    try:
        page = await capture_page(source, body.url, credential=body.credential)
    except SourceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EgressRefused as exc:
        logger.info("public source capture refused: %s", exc)
        return JSONResponse(status_code=403, content={"detail": str(exc), "code": "egress_refused"})
    except CaptureError as exc:
        if exc.code:
            return JSONResponse(status_code=exc.status, content={"detail": str(exc), "code": exc.code})
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("public source capture failed for source %s", body.source)
        raise HTTPException(status_code=502, detail="the source is not reachable right now") from exc
    return {
        "url": page.url,
        "finalUrl": page.final_url,
        "contentType": page.content_type,
        "sha256": page.sha256,
        "bytes": page.size,
        "text": page.text,
        "pages": page.pages,
        "note": page.note or None,
        "retrievedAt": page.retrieved_at,
    }


async def check_public_source(body: SourceRequest, _: None = Depends(_require_internal_token)) -> dict:
    """KC-7 (ADR-0174): ``{valid, problems: [{fixture, detail}], fixtures: [{name, ok, requested}]}``. No live call."""
    from public_sources.fixtures import run_source
    from public_sources.source import SourceError
    from public_sources.source import parse_inline_source

    try:
        source = parse_inline_source(body.config)
    except SourceError as exc:
        return {"valid": False, "problems": [{"fixture": None, "detail": str(exc)[:2000]}], "fixtures": []}
    results = await run_source(source)
    problems = [{"fixture": r.fixture, "detail": failure[:1000]} for r in results for failure in r.failures]
    return {
        "valid": not problems,
        "problems": problems,
        "fixtures": [{"name": r.fixture, "ok": r.ok, "requested": r.requested} for r in results],
    }


async def probe_public_source(body: ProbeRequest, _: None = Depends(_require_internal_token)) -> dict:
    """One monitor check (ADR-0174): what the probe saw, whether it changed, and the page's text for a capture."""
    from public_sources.access import AccessError
    from public_sources.egress import EgressRefused
    from public_sources.monitor import MonitorError
    from public_sources.monitor import Seen as SeenState
    from public_sources.monitor import probe

    source = _configured(body.config)
    previous = SeenState(
        etag=body.previous.etag,
        sha256=body.previous.sha256,
        version=body.previous.version,
        terms_sha256=body.previous.termsSha256,
    )
    try:
        result = await probe(source, previous, credential=body.credential)
    except MonitorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except EgressRefused as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AccessError as exc:
        raise HTTPException(status_code=502, detail=str(exc)[:500]) from exc
    except Exception as exc:
        logger.exception("public source probe failed for source %s", source.id)
        raise HTTPException(status_code=502, detail="the source is not reachable right now") from exc
    return {
        "changed": result.changed,
        "termsChanged": result.terms_changed,
        "termsUnwatched": result.terms_unwatched,
        "current": {
            "etag": result.current.etag,
            "sha256": result.current.sha256,
            "version": result.current.version,
            "termsSha256": result.current.terms_sha256,
        },
        "url": result.url,
        "contentType": result.content_type,
        "bytes": result.size,
        "text": result.text,
        "anchors": list(result.anchors)[:500],
    }


def add_public_source_capture_routes(router: APIRouter) -> None:
    """The public-source routes the BFF calls: capture, check (KC-7) and probe (a monitor check)."""
    router.post(
        "/v1/public-sources/capture",
        tags=["public-sources"],
        summary="Capture a page of a configured public source (internal)",
        # A refusal with a problem code is a JSONResponse beside the dict, which no response model describes.
        response_model=None,
    )(capture_public_source_page)
    router.post(
        "/v1/public-sources/check",
        tags=["public-sources"],
        summary="Validate a configured public source and run its recorded fixtures (internal)",
    )(check_public_source)
    router.post(
        "/v1/public-sources/probe",
        tags=["public-sources"],
        summary="Check a configured public source for a change since the last check (internal)",
    )(probe_public_source)
