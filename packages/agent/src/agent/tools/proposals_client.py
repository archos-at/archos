from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any
from typing import Literal

from agent import project_context
from agent.cards.registry import CardRegistry
from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope
from agent.observability.retrieval_trace import emit_step_span
from agent.turn.response import turn_answer_message_id

logger = logging.getLogger(__name__)

PROPOSALS_PATH = "/api/internal/proposals"

REQUEST_TIMEOUT_SECONDS = 10

ProposalKind = Literal["file_operation", "memory", "project_profile"]


class ProposalRequestError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message, status=status)


def post_proposal(payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        body = bff_http.post_json(PROPOSALS_PATH, payload, timeout=REQUEST_TIMEOUT_SECONDS, headers=envelope.headers())
    except bff_http.BffNotConfiguredError as exc:
        raise ProposalRequestError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        raise ProposalRequestError(f"the proposals route refused ({exc.status})", status=exc.status) from exc
    except bff_http.BffError as exc:
        raise ProposalRequestError("the proposals route could not be reached") from exc
    if not isinstance(body, dict):
        raise ProposalRequestError("the proposals route answered with something that is not an object")
    return body


def proposal_request(kind: ProposalKind, payload: dict[str, Any], *, card_index: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"op": "create", "kind": kind, "payload": payload}
    conversation_id = project_context.get_conversation_id_from_context()
    if conversation_id:
        body["answerMessageId"] = turn_answer_message_id(conversation_id)
        if card_index is not None:
            body["originCardIndex"] = card_index
    return body


def _proposal_id(body: dict[str, Any]) -> str | None:
    value = body.get("id")
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


async def create_proposal(kind: ProposalKind, payload: dict[str, Any], *, card_index: int | None = None) -> str | None:
    observed = {"kind": kind, "card_index": card_index}
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        emit_step_span("proposals.create", observed, {"outcome": "fallback", "reason": "no_envelope"})
        return None
    request = proposal_request(kind, payload, card_index=card_index)
    try:
        body = await asyncio.to_thread(post_proposal, request, SignedEnvelope(header=header, signature=signature))
    except ProposalRequestError as exc:
        logger.warning("Proposal (%s) not stored, card keeps its old path: %s", kind, exc)
        emit_step_span("proposals.create", observed, {"outcome": "fallback", "reason": "refused", "status": exc.status})
        return None
    proposal_id = _proposal_id(body)
    if proposal_id is None:
        logger.warning("Proposals route answered without a usable id (%s); card keeps its old path", kind)
        emit_step_span("proposals.create", observed, {"outcome": "fallback", "reason": "no_id"})
        return None
    emit_step_span("proposals.create", observed, {"outcome": "created", "status": body.get("status")})
    return proposal_id


async def add_card(
    registry: CardRegistry, card: dict[str, Any], *, kind: ProposalKind, payload: dict[str, Any]
) -> str | None:
    index = len(registry)
    registry.add({key: value for key, value in card.items() if key != "proposal_id"})
    proposal_id = await create_proposal(kind, payload, card_index=index)
    if proposal_id is not None:
        registry.replace(index, {**card, "proposal_id": proposal_id})
    return proposal_id
