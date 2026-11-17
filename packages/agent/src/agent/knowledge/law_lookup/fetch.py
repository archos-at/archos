from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from agent.knowledge.law_lookup.cache import fetch_document_cached
from agent.knowledge.law_lookup.candidates import Candidate
from agent.knowledge.law_lookup.client import Document
from agent.knowledge.law_lookup.trace import LookupTrace

logger = logging.getLogger(__name__)

MAX_FETCHES = 2


@dataclass(frozen=True)
class FetchedDocument:
    candidate: Candidate
    document: Document


async def fetch_documents(client, candidates: list[Candidate], trace: LookupTrace, ttl: int) -> list[FetchedDocument]:
    targets = [candidate for candidate in candidates if candidate.fetchable][:MAX_FETCHES]
    if not targets:
        return []
    results = await asyncio.gather(
        *(fetch_document_cached(client, candidate.url, ttl) for candidate in targets), return_exceptions=True
    )
    return [
        document
        for candidate, result in zip(targets, results, strict=True)
        if (document := _fetched(candidate, result, trace)) is not None
    ]


def _fetched(candidate: Candidate, result, trace: LookupTrace) -> FetchedDocument | None:
    if isinstance(result, BaseException):
        logger.info("law_lookup: fetch failed for %s (%s)", candidate.url, result)
        return None
    trace.fetched.append(candidate.url)
    return FetchedDocument(candidate=candidate, document=result)
