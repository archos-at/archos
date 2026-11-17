from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from agent.common import bff_http
from agent.knowledge.project_memory import TEMPORARY_CONVERSATION_CODE
from agent.knowledge.project_memory import VALID_PROVENANCES
from agent.knowledge.project_memory import TemporaryConversationError
from agent.knowledge.project_memory import looks_like_secret
from agent.knowledge.project_memory import memory_topic
from agent.knowledge.project_memory import record_turn_memory_write
from agent.knowledge.project_memory import turn_answer_message

logger = logging.getLogger(__name__)

INTERNAL_PERSONAL_MEMORY_PATH = "/api/internal/personal-memory"

VALID_PERSONAL_KINDS = {"preference", "profile"}

PERSONAL_MEMORY_HEADER = "PERSONAL_MEMORY v1"

_REQUEST_TIMEOUT_SECONDS = 5
_MAX_CONTENT_CHARS = 2000


@dataclass(frozen=True)
class PersonalMemoryWrite:
    id: str
    created: bool


def insert_personal_memory_item(
    *,
    envelope: bff_http.SignedEnvelope,
    kind: str,
    content: str,
    conversation_id: str | None = None,
    provenance_type: str = "agent",
    topic: str | None = None,
) -> PersonalMemoryWrite | None:
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
    if kept_topic := memory_topic(topic):
        payload["topic"] = kept_topic
    answer_message_id = turn_answer_message()
    if answer_message_id:
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
    record_turn_memory_write(content)
    return PersonalMemoryWrite(id=str(item_id), created=body.get("created") is not False)


INTERNAL_PERSONAL_MEMORY_FORGET_PATH = f"{INTERNAL_PERSONAL_MEMORY_PATH}/forget"

ForgetRefusal = Literal["not_found", "curated"]


@dataclass(frozen=True)
class PersonalMemoryForget:
    removed_id: str | None
    refused: ForgetRefusal | None


def forget_personal_memory_item(*, envelope: bff_http.SignedEnvelope, content: str) -> PersonalMemoryForget:
    body = bff_http.post_json(
        INTERNAL_PERSONAL_MEMORY_FORGET_PATH,
        {"content": content.strip()[:_MAX_CONTENT_CHARS]},
        timeout=_REQUEST_TIMEOUT_SECONDS,
        headers=envelope.headers(),
    )
    if not isinstance(body, dict):
        raise bff_http.BffMalformedResponseError("the personal-memory forget route answered no object")
    removed = body.get("removedId")
    refused = body.get("refused")
    if removed:
        return PersonalMemoryForget(removed_id=str(removed), refused=None)
    if refused in ("not_found", "curated"):
        return PersonalMemoryForget(removed_id=None, refused=refused)
    raise bff_http.BffMalformedResponseError("the personal-memory forget route answered neither a note nor a reason")
