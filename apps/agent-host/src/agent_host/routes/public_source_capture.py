"""Capture one page of a configured public source, for a citation (ADR-0170).

An operator's agent onboarding a country cites pages, and the BFF stores what
each citation is checked against (KC-6). The BFF cannot fetch: the sandboxed
public-source fetcher admits the backend roles only (ADR-0162, its
NetworkPolicy). So the BFF asks here, and this route makes the request through
:func:`public_sources.capture.capture_page`, which uses the same transport every
source reader uses: the source's hosts checked at every redirect, a public
address, GET only. It answers the bytes' sha256 and size and the page's text;
the BFF stores them in the change request's capture.

Public pages only, never a tenant's content, and nothing is kept here.
Internal-token guarded like every other service-to-service route: reached from
the BFF, never from a browser.
"""

import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import Field

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


class CaptureRequest(BaseModel):
    source: str = Field(
        ..., pattern=r"^[a-z]{2}-[a-z0-9-]{1,60}$", description="The configured source's id, e.g. at-ris."
    )
    url: str = Field(..., min_length=8, max_length=2000)


def add_public_source_capture_routes(router: APIRouter) -> None:
    @router.post(
        "/v1/public-sources/capture",
        tags=["public-sources"],
        summary="Capture a page of a configured public source (internal)",
    )
    async def capture_public_source_page(body: CaptureRequest, _: None = Depends(_require_internal_token)) -> dict:
        """Return ``{url, finalUrl, contentType, sha256, bytes, text, retrievedAt}`` for one page."""
        from public_sources.capture import CaptureError
        from public_sources.capture import capture_page
        from public_sources.egress import EgressRefused
        from public_sources.source import SourceError

        try:
            page = await capture_page(body.source, body.url)
        except SourceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except EgressRefused as exc:
            logger.info("public source capture refused: %s", exc)
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except CaptureError as exc:
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
            "retrievedAt": page.retrieved_at,
        }
