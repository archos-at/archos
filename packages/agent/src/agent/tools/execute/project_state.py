from __future__ import annotations

import asyncio
import logging

from agent import project_context
from agent.common.bff_http import SignedEnvelope

from ..documents.draft_store import FILED_DOCUMENT_KEY
from ..documents.draft_store import FILED_HASH_KEY
from ..documents.draft_store import DraftBackend
from ..documents.filing import FilingError
from ..documents.filing import post_document_version

logger = logging.getLogger(__name__)

MAX_CHECKED = 4

CHECK_TIMEOUT_S = 3.0


def _envelope() -> SignedEnvelope | None:
    header, signature = project_context.get_request_envelope_from_context()
    return SignedEnvelope(header=header, signature=signature) if header and signature else None


async def _current(document_id: str, envelope: SignedEnvelope) -> dict:
    payload = {"op": "status", "documentId": document_id}
    try:
        body = await asyncio.wait_for(asyncio.to_thread(post_document_version, payload, envelope), CHECK_TIMEOUT_S)
    except FilingError, TimeoutError:
        logger.info("execute: the project state of a filed draft could not be read")
        return {}
    version = body.get("version")
    return version if isinstance(version, dict) else {}


def _note(path: str, version: dict) -> str:
    number = version.get("versionNumber")
    which = f" (now Fassung {number})" if isinstance(number, int) else ""
    return (
        f"note: {path} was changed in the project by a person since it was filed{which}; this run worked on the "
        "conversation's copy, which lacks their changes. To build on their version, name the project document in "
        "`documents` and write the result to this path. Tell the user which version you used."
    )


async def changed_in_project(backend: DraftBackend, draft_paths: list[str]) -> list[str]:
    envelope = _envelope()
    if envelope is None:
        return []
    filings = await backend.afilings(draft_paths)
    checked = [
        (path, filing)
        for path, filing in filings.items()
        if filing.get(FILED_DOCUMENT_KEY) and filing.get(FILED_HASH_KEY)
    ][:MAX_CHECKED]
    versions = await asyncio.gather(*(_current(filing[FILED_DOCUMENT_KEY], envelope) for _, filing in checked))
    return [
        _note(path, version)
        for (path, filing), version in zip(checked, versions, strict=True)
        if isinstance(version.get("contentHash"), str)
        and version["contentHash"]
        and version["contentHash"] != filing[FILED_HASH_KEY]
    ]
