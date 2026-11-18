from __future__ import annotations

import asyncio
import logging

from agent import project_context
from agent.common.bff_http import SignedEnvelope

from ..documents.draft_store import FILED_DOCUMENT_KEY
from ..documents.draft_store import FILED_HASH_KEY
from ..documents.draft_store import DraftBackend
from ..documents.draft_store import filing_from_value
from ..documents.filing import FilingError
from ..documents.filing import post_document_version

logger = logging.getLogger(__name__)

MAX_CHECKED = 4


def _envelope() -> SignedEnvelope | None:
    header, signature = project_context.get_request_envelope_from_context()
    return SignedEnvelope(header=header, signature=signature) if header and signature else None


async def _current(document_id: str, envelope: SignedEnvelope) -> dict:
    try:
        body = await asyncio.to_thread(post_document_version, {"op": "status", "documentId": document_id}, envelope)
    except FilingError:
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
    store = backend._get_store()
    namespace = backend._get_namespace()
    notes: list[str] = []
    checked = 0
    for path in draft_paths:
        if checked >= MAX_CHECKED:
            break
        item = await store.aget(namespace, path)
        filing = filing_from_value(item.value) if item is not None else {}
        if not filing.get(FILED_DOCUMENT_KEY) or not filing.get(FILED_HASH_KEY):
            continue
        checked += 1
        version = await _current(filing[FILED_DOCUMENT_KEY], envelope)
        current = version.get("contentHash")
        if isinstance(current, str) and current and current != filing[FILED_HASH_KEY]:
            notes.append(_note(path, version))
    return notes
