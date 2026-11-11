"""Personal memory client: the agent's one write to a person's own notes (ADR-0180).

A note about the person asking (how they want the agent to work, their role,
what they said in confidence) is kept where only they read it:
``POST /api/internal/personal-memory``. The BFF takes the owner from the turn's
signed envelope and never from the body, so this client has no ``user_id``
argument to get wrong, and a run without an envelope cannot write at all.

The read side is not here: the person's ``PERSONAL_MEMORY v1`` block arrives
with the turn context (``turn/context_client.py``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from agent.common import bff_http
from agent.knowledge.project_memory import TEMPORARY_CONVERSATION_CODE
from agent.knowledge.project_memory import VALID_PROVENANCES
from agent.knowledge.project_memory import TemporaryConversationError
from agent.knowledge.project_memory import looks_like_secret
from agent.knowledge.project_memory import record_turn_memory_write
from agent.knowledge.project_memory import turn_answer_message

logger = logging.getLogger(__name__)

INTERNAL_PERSONAL_MEMORY_PATH = "/api/internal/personal-memory"

#: ``preference``: how the person wants the agent to work. ``profile``: who
#: they are at work (role, responsibilities, recurring topics, a confidence).
VALID_PERSONAL_KINDS = {"preference", "profile"}

#: The header line that opens the block the BFF renders (the turn context's ``personalMemory``).
PERSONAL_MEMORY_HEADER = "PERSONAL_MEMORY v1"

_REQUEST_TIMEOUT_SECONDS = 5
_MAX_CONTENT_CHARS = 2000


@dataclass(frozen=True)
class PersonalMemoryWrite:
    """A personal note the BFF stored."""

    id: str
    #: False when a note that said the same already existed and was refreshed.
    created: bool


def insert_personal_memory_item(
    *,
    envelope: bff_http.SignedEnvelope,
    kind: str,
    content: str,
    conversation_id: str | None = None,
    provenance_type: str = "agent",
) -> PersonalMemoryWrite | None:
    """Record one note in the personal memory of the person the envelope names.

    Returns the stored note, or None in exactly one case: ``content`` matches a
    secret shape (:func:`looks_like_secret`) and nothing was sent. Raises
    :class:`TemporaryConversationError` when the conversation keeps nothing, and
    :class:`agent.common.bff_http.BffError` (a ``RuntimeError``) for
    configuration, refusal (401 without a valid envelope) and transport
    failures. Blocking; call via ``asyncio.to_thread``.
    """
    if kind not in VALID_PERSONAL_KINDS:
        raise ValueError(f"Invalid kind '{kind}'. Must be one of: {sorted(VALID_PERSONAL_KINDS)}")
    if provenance_type not in VALID_PROVENANCES:
        provenance_type = "agent"
    if looks_like_secret(content):
        logger.info("Personal note not recorded: content matches a secret shape")
        return None
    payload: dict[str, object] = {
        "kind": kind,
        "content": content.strip()[:_MAX_CONTENT_CHARS],
        "provenanceType": provenance_type,
    }
    if conversation_id:
        payload["sourceConversationId"] = conversation_id
    answer_message_id = turn_answer_message()
    if answer_message_id:
        # The answer this note was saved under. The note itself is never put on
        # that message (other people read it): the owner's browser asks for
        # their notes of the conversation and shows each under its answer.
        payload["sourceMessageId"] = answer_message_id
    try:
        body = bff_http.post_json(
            INTERNAL_PERSONAL_MEMORY_PATH, payload, timeout=_REQUEST_TIMEOUT_SECONDS, headers=envelope.headers()
        )
    except bff_http.BffRefusedError as exc:
        if exc.status == 403 and exc.code == TEMPORARY_CONVERSATION_CODE:
            raise TemporaryConversationError("the conversation is temporary", status=403, code=exc.code) from exc
        logger.warning("Internal personal-memory endpoint returned %s", exc.status)
        raise
    item = body.get("item") if isinstance(body, dict) else None
    item_id = item.get("id") if isinstance(item, dict) else None
    if not item_id:
        raise bff_http.BffMalformedResponseError("the personal-memory route answered without an item id")
    # So the reflection stage reads it as already recorded and does not file it again.
    record_turn_memory_write(content)
    return PersonalMemoryWrite(id=str(item_id), created=body.get("created") is not False)
