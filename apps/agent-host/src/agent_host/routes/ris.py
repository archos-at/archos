import logging
import re
from typing import TYPE_CHECKING

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from .internal_auth import _require_internal_token

if TYPE_CHECKING:
    from ris_adapter.client import RisClient

logger = logging.getLogger(__name__)

MAX_DOCUMENT_TEXT_CHARS = 1_000_000

_PASSAGE_ANCHOR_WORDS = 12


def _passage_offset(text: str, passage: str) -> int | None:
    words = passage.split()[:_PASSAGE_ANCHOR_WORDS]
    if len(words) < 4:
        return None
    pattern = re.compile(r"\s+".join(re.escape(word) for word in words), re.IGNORECASE)
    first = pattern.search(text)
    if first is None:
        return None
    if pattern.search(text, first.end()) is not None:
        return None
    return first.start()


def _clip_around_passage(text: str, passage: str) -> tuple[str, bool]:
    if len(text) <= MAX_DOCUMENT_TEXT_CHARS:
        return text, False
    start = _passage_offset(text, passage) if passage else None
    if start is None:
        return text[:MAX_DOCUMENT_TEXT_CHARS], True
    begin = max(0, start - MAX_DOCUMENT_TEXT_CHARS // 2)
    return text[begin : begin + MAX_DOCUMENT_TEXT_CHARS], True


_RIS_CLIENT: RisClient | None = None


def _client() -> RisClient:
    global _RIS_CLIENT
    if _RIS_CLIENT is None:
        from ris_adapter.client import RisClient

        _RIS_CLIENT = RisClient(cache_max_entries=4)
    return _RIS_CLIENT


def add_ris_routes(router: APIRouter) -> None:
    @router.get(
        "/v1/ris/document",
        tags=["ris"],
        summary="Fetch a RIS document's text (internal)",
    )
    async def get_ris_document(
        reference: str = Query(..., min_length=1, max_length=2048),
        application: str = Query("", max_length=32),
        passage: str = Query("", max_length=2_000),
        _: None = Depends(_require_internal_token),
    ) -> dict:
        from ris_adapter.cache import fetch_document_cached
        from ris_adapter.client import RisError
        from ris_adapter.client import build_document_url

        reference = reference.strip()
        try:
            if reference.lower().startswith(("http://", "https://")):
                url = reference
            else:
                url = build_document_url(reference, application)
            document = await fetch_document_cached(_client(), url)
        except RisError as exc:
            logger.info("ris document fetch refused: %s", exc)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("ris document fetch failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RIS is not reachable right now",
            ) from exc

        text, truncated = _clip_around_passage(document.text, passage.strip())

        return {
            "url": document.url,
            "title": document.title,
            "text": text,
            "truncated": truncated,
        }
