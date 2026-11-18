from __future__ import annotations

import asyncio
import logging
from typing import Any

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.retrieval_trace import emit_step_span
from agent.turn.response import turn_answer_message_id

from .client import CanvasRequestError
from .client import post_canvas
from .legacy_reasons import LEGACY_AGENT_DIRECT_EDITS_OFF_CODE
from .legacy_reasons import LEGACY_AGENT_DIRECT_EDITS_OFF_REASON
from .target import Target

logger = logging.getLogger(__name__)

FEATURE_TAG = "feature:canvas"


class Refused(Exception):
    def __init__(self, message: str, code: str = "invalid_arguments") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


NO_ENVELOPE = (
    "Error: This run has no signed session credential, so you cannot read or write in any document. Do not retry."
)
NO_DOCUMENT = (
    "Which document? This chat belongs to no document, and none is open. Name it in `document` "
    "(the file name from the overview) or ask which one is meant."
)
FORBIDDEN = (
    "Not possible: The person may not change anything on this document, or this chat may not read it. "
    "Tell them so; do not retry."
)
DOCUMENT_GONE = (
    "This document does not exist (any more), it is not yet released, or this chat may not read it. Do not retry."
)
ANNOTATION_GONE = "This annotation does not exist (any more) on the document. Read `marks` and use its id or number."
CONFLICT = "Someone has just changed the annotations. Re-read them with `marks` before you continue."
DELETE_FORBIDDEN = (
    "Not possible: The person can delete only annotations they set themselves, and only if they may change "
    "this document. Tell them so; resolving (`update` with `status` `resolved`) works if they "
    "want it."
)
DELETE_KEPT_REASONS = frozenset({"mark-discussed", "mark-carried"})
DELETE_KEPT = (
    "Not deleted: Others have replied in this annotation's thread, or it was carried over between documents. "
    "It stays so that its thread and its number are kept. Tell the person so; resolving "
    "(`update` with `status` `resolved`) works if they want it."
)
ASSIGNEE_UNCLEAR = (
    "Unclear who is meant ({detail}). Ask the person whom they mean, then use the full name; nothing was changed."
)
AGENT_DIRECT_EDITS_OFF = "agent-direct-edits-off"
PROPOSE_ONLY_MARK = (
    "Not set: This office lets you only propose annotations. Set them with `mark` without `open` as a "
    "proposal and tell the person they can take it over in the document."
)
PROPOSE_ONLY_CHANGE = (
    "Not changed: This office lets you only propose annotations, not change or delete them. Tell the "
    "person they can do this in the document themselves; do not retry."
)
UNREACHABLE = (
    "Error: The document is not reachable right now. Tell the person it did not work; do not retry in the same answer."
)


def envelope() -> SignedEnvelope:
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        raise Refused(NO_ENVELOPE, "no_envelope")
    return SignedEnvelope(header=header, signature=signature)


def _with_answer(payload: dict[str, Any]) -> dict[str, Any]:
    conversation_id = project_context.get_conversation_id_from_context()
    if not conversation_id:
        return payload
    return {**payload, "answerMessageId": turn_answer_message_id(conversation_id)}


_ON_ONE_MARK = frozenset({"reply", "update", "delete"})


def refusal_for(exc: CanvasRequestError, operation: str) -> Refused:
    if exc.reason == "no-document-subject":
        return Refused(NO_DOCUMENT, "no_document_subject")
    if exc.reason in (AGENT_DIRECT_EDITS_OFF, LEGACY_AGENT_DIRECT_EDITS_OFF_REASON):
        message = PROPOSE_ONLY_MARK if operation == "create" else PROPOSE_ONLY_CHANGE
        return Refused(message, LEGACY_AGENT_DIRECT_EDITS_OFF_CODE)
    if exc.reason in ("assignee-unknown", "assignee-ambiguous"):
        return Refused(ASSIGNEE_UNCLEAR.format(detail=exc), "assignee_unclear")
    if exc.reason in DELETE_KEPT_REASONS:
        return Refused(DELETE_KEPT, "delete_kept")
    if exc.status == 403:
        return Refused(DELETE_FORBIDDEN if operation == "delete" else FORBIDDEN, "forbidden")
    if exc.status == 404:
        return Refused(ANNOTATION_GONE if operation in _ON_ONE_MARK else DOCUMENT_GONE, "not_found")
    if exc.status == 409:
        return Refused(CONFLICT, "conflict")
    if exc.status in (400, 422):
        return Refused(f"Error: The request was rejected ({exc}). Correct the arguments.", "invalid")
    return Refused(UNREACHABLE, "unreachable")


async def call(payload: dict[str, Any], target: Target, signed: SignedEnvelope) -> dict[str, Any]:
    body = _with_answer({**payload, **target.body()})
    try:
        return await asyncio.to_thread(post_canvas, body, signed)
    except CanvasRequestError as exc:
        raise refusal_for(exc, str(payload.get("op"))) from exc


def observe(step: str, request: dict[str, Any], outcome: dict[str, Any]) -> None:
    add_trace_tag(FEATURE_TAG)
    emit_step_span(f"canvas.{step}", request, outcome)


def document_of(body: dict[str, Any], target: Target) -> dict[str, str]:
    name = body.get("documentName") or target.file_name or "Dokument"
    return {"id": str(body.get("documentId") or target.document_id or ""), "name": str(name)}
