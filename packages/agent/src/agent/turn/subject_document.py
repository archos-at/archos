from __future__ import annotations

import asyncio
import logging
import unicodedata

from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common.retrieval_status import SUBJECT_ABSENT
from agent.common.retrieval_status import SUBJECT_EMPTY
from agent.common.retrieval_status import SUBJECT_NOT_STORED
from agent.common.retrieval_status import SUBJECT_REFUSED
from agent.common.retrieval_status import SUBJECT_UNREACHABLE
from agent.common.retrieval_status import subject_document_step
from agent.common.wire_v2 import StatusStep
from agent.knowledge.restricted_use import current_restricted_use
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import FILED_DOCUMENT_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import DraftUsage
from agent.tools.documents.draft_store import filing_record
from agent.tools.documents.draft_store import get_draft_backend
from agent.tools.documents.filing import FilingError
from agent.tools.documents.filing import get_document_version_content
from agent.turn.payload import SubjectVersion
from agent.turn.response import turn_answer_message_id

logger = logging.getLogger(__name__)

MAX_NAME_CHARS = 197

_UNSAFE = {"/", "\\", "\x00"}


def draft_path(display_name: str) -> str:
    name = unicodedata.normalize("NFC", display_name or "").strip()
    name = "".join("-" if character in _UNSAFE or character < " " else character for character in name)
    while ".." in name:
        name = name.replace("..", ".")
    name = " ".join(name.split()).strip(". ")
    for suffix in (".md", ".markdown"):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    return f"{DRAFT_ROOT}{(name or 'dokument')[:MAX_NAME_CHARS]}.md"


async def _fetch(version_id: str, organization_id: str, conversation_id: str, user_id: str | None) -> dict | StatusStep:
    try:
        return await asyncio.to_thread(
            get_document_version_content,
            version_id,
            organization_id,
            conversation_id,
            user_id,
            turn_answer_message_id(conversation_id),
        )
    except FilingError as refused:
        if refused.status == 404:
            logger.info("Subject version %s is not this conversation's subject; the turn continues", version_id)
            return subject_document_step(loaded=False, version_id=version_id, reason=SUBJECT_ABSENT)
        reason = SUBJECT_REFUSED if refused.status is not None else SUBJECT_UNREACHABLE
        logger.warning("Subject version %s could not be read: %s", version_id, refused)
        return subject_document_step(loaded=False, version_id=version_id, reason=reason)


def already_loaded(usage: DraftUsage, filing: dict[str, str]) -> bool | None:
    if usage.content is None:
        return False
    stored = usage.filing.get(FILED_DOCUMENT_KEY)
    return True if stored == filing[FILED_DOCUMENT_KEY] else None


async def _write(backend: DraftBackend, path: str, text: str, filing: dict[str, str]) -> bool:
    token = set_card_registry(None)
    try:
        result = await backend.awrite(path, text)
    finally:
        reset_card_registry(token)
    if result.error:
        logger.warning("Subject document not written to %s: %s", path, result.error)
        return False
    await backend.arecord_filing(path, filing)
    return True


async def load_subject_document(
    subject: SubjectVersion,
    *,
    conversation_id: str | None,
    organization_id: str | None,
    user_id: str | None = None,
) -> StatusStep | None:
    try:
        return await _load_subject_document(
            subject, conversation_id=conversation_id, organization_id=organization_id, user_id=user_id
        )
    except Exception:  # noqa: BLE001 - one document is worth strictly less than the answer
        logger.warning("Subject document load failed; the turn continues without it", exc_info=True)
        return None


async def _load_subject_document(
    subject: SubjectVersion,
    *,
    conversation_id: str | None,
    organization_id: str | None,
    user_id: str | None,
) -> StatusStep | None:
    if not subject.is_open or not conversation_id or not organization_id:
        return None

    assert subject.version_id is not None  # noqa: S101 - `is_open` is the check; this is for the type
    body = await _fetch(subject.version_id, organization_id, conversation_id, user_id)
    if isinstance(body, StatusStep):
        return body
    if body.get("drewOnRestrictedFolder") and (use := current_restricted_use()) is not None:
        use.note_recorded()

    text = body.get("content")
    if not isinstance(text, str) or not text.strip():
        logger.info("Subject version %s has no text to read", subject.version_id)
        return subject_document_step(loaded=False, version_id=subject.version_id, reason=SUBJECT_EMPTY)

    path = draft_path(str(body.get("displayName") or body.get("filename") or ""))
    filing = filing_record(body)
    backend = await get_draft_backend(conversation_id)
    standing = already_loaded(await backend.ausage(path), filing)
    if standing is None:
        logger.warning("Working-directory path %s belongs to another document; subject not read", path)
        return subject_document_step(loaded=False, version_id=subject.version_id, reason=SUBJECT_NOT_STORED)
    if standing:
        logger.debug("Subject document %s already in the working directory at %s", subject.document_id, path)
        return None
    if not await _write(backend, path, text, filing):
        return subject_document_step(loaded=False, version_id=subject.version_id, reason=SUBJECT_NOT_STORED)

    logger.info("Subject document %s (%s) read into %s", subject.document_id, subject.state, path)
    return subject_document_step(
        loaded=True,
        document_id=subject.document_id,
        version_id=subject.version_id,
        state=subject.state,
        path=path,
        chars=len(text),
    )
