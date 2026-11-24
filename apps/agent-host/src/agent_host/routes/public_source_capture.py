import asyncio
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
    config: dict[str, Any] | None = None
    credential: str | None = Field(default=None, min_length=1, max_length=4000)


class SourceRequest(BaseModel):
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


async def _captured(body: CaptureRequest):
    from public_sources.capture import CaptureError
    from public_sources.capture import capture_page
    from public_sources.egress import EgressRefused
    from public_sources.source import SourceError

    source = _configured(body.config) if body.config is not None else body.source
    if body.config is not None and body.config.get("id") != body.source:
        raise HTTPException(status_code=422, detail="the configuration is not of the named source")
    try:
        return await capture_page(source, body.url, credential=body.credential)
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


async def capture_public_source_page(
    body: CaptureRequest, _: None = Depends(_require_internal_token)
) -> dict | JSONResponse:
    page = await _captured(body)
    if isinstance(page, JSONResponse):
        return page
    return {**_page_facts(page), "text": page.text}


def _page_facts(page) -> dict:
    return {
        "url": page.url,
        "finalUrl": page.final_url,
        "contentType": page.content_type,
        "sha256": page.sha256,
        "bytes": page.size,
        "pages": page.pages,
        "note": page.note or None,
        "retrievedAt": page.retrieved_at,
    }


class CorpusTextRequest(CaptureRequest):
    fileStem: str = Field(..., pattern=r"^[a-z0-9][a-z0-9._-]{0,99}$", description="The manifestation's key.")


def corpus_text_name(stem: str, sha256: str) -> str:
    return f"{stem}-{sha256[:12]}.pdf"


def _keep_corpus_text(name: str, content: bytes, sha256: str) -> str:
    from agent import corpus_store
    from agent import oib_sync
    from agent.common.norm_registry import guess_doc_class

    from ..jobs.ingest_dispatch import enqueue_only

    row = corpus_store.get_file(name)
    if row is not None:
        return "unchanged" if row.sha256 == sha256 else "name_taken"
    try:
        oib_sync.store_and_request(name, content, guess_doc_class(name), enqueue=enqueue_only)
    except corpus_store.CorpusFileImmutable:
        return "name_taken"
    return "stored"


async def import_public_source_text(
    body: CorpusTextRequest, _: None = Depends(_require_internal_token)
) -> dict | JSONResponse:
    from public_sources.pdf import is_pdf

    page = await _captured(body)
    if isinstance(page, JSONResponse):
        return page
    if page.pages is None or not is_pdf(page.content, page.content_type):
        detail = "the URL answers no PDF; a text kept in the base corpus is a PDF"
        return JSONResponse(status_code=422, content={"detail": detail, "code": "not_a_pdf"})
    name = corpus_text_name(body.fileStem, page.sha256)
    try:
        outcome = await asyncio.to_thread(_keep_corpus_text, name, page.content, page.sha256)
    except Exception as exc:
        logger.exception("a fetched text could not be kept in the base corpus")
        raise HTTPException(status_code=502, detail="the base corpus did not take the file") from exc
    if outcome == "name_taken":
        detail = f"the base corpus keeps a different file as {name}"
        return JSONResponse(status_code=409, content={"detail": detail, "code": "name_taken"})
    return {**_page_facts(page), "fileName": name, "stored": outcome == "stored"}


async def check_public_source(body: SourceRequest, _: None = Depends(_require_internal_token)) -> dict:
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
        "valid": all(r.ok for r in results),
        "problems": problems,
        "fixtures": [
            {"name": r.fixture, "ok": r.ok, "requested": r.requested, "awaiting": r.awaiting} for r in results
        ],
    }


_built_in: list[dict] | None = None


class BuiltInRequest(BaseModel): ...


async def built_in_public_sources(_: BuiltInRequest, __: None = Depends(_require_internal_token)) -> dict:
    global _built_in
    if _built_in is None:
        from public_sources.fixtures import run_source
        from public_sources.source import load_sources

        _built_in = [_built_in_view(source, await run_source(source)) for source in load_sources().values()]
    return {"sources": _built_in}


def _built_in_view(source, results) -> dict:
    problems = [{"fixture": r.fixture, "detail": failure[:1000]} for r in results for failure in r.failures]
    return {
        "sourceKey": source.id,
        "title": source.title,
        "territory": source.territory,
        "protocol": source.protocol,
        "format": source.format,
        "hosts": list(source.hosts),
        "dataFlow": source.data_flow,
        "licence": source.terms.licence,
        "monitor": {"kind": source.monitor.kind, "intervalHours": source.monitor.interval_hours},
        "credentialHeader": source.credential.header if source.credential else None,
        "fixtures": {
            "valid": not problems,
            "problems": problems,
            "fixtures": [{"name": r.fixture, "ok": r.ok, "requested": r.requested} for r in results],
        },
    }


async def probe_public_source(body: ProbeRequest, _: None = Depends(_require_internal_token)) -> dict:
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
    router.post(
        "/v1/public-sources/capture",
        tags=["public-sources"],
        summary="Capture a page of a configured public source (internal)",
        response_model=None,
    )(capture_public_source_page)
    router.post(
        "/v1/public-sources/corpus-text",
        tags=["public-sources"],
        summary="Fetch a public PDF of a configured source and keep it as a base-corpus file (internal)",
        response_model=None,
    )(import_public_source_text)
    router.post(
        "/v1/public-sources/check",
        tags=["public-sources"],
        summary="Validate a configured public source and run its recorded fixtures (internal)",
    )(check_public_source)
    router.post(
        "/v1/public-sources/built-in",
        tags=["public-sources"],
        summary="List the repository's built-in public sources with their fixtures' result (internal)",
    )(built_in_public_sources)
    router.post(
        "/v1/public-sources/probe",
        tags=["public-sources"],
        summary="Check a configured public source for a change since the last check (internal)",
    )(probe_public_source)
