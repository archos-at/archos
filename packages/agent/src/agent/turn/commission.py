from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any
from typing import Literal

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.common.plan_documents import PlanDocuments
from agent.tools.tasks.client import DelegationError
from agent.tools.tasks.client import post_task

logger = logging.getLogger(__name__)

MAX_QUESTION_CHARS = 500

MAX_CONTEXT_CHARS = 8_000

CommissionRefusal = Literal["no_project", "no_envelope", "forbidden", "confined", "busy", "unreachable"]

CONVERSATION_CONFINED_CODE = "CONVERSATION_CONFINED"


@dataclass(frozen=True)
class CommissionedRun:
    run_id: str
    run_message_id: str | None
    conversation_id: str


class CommissionRefused(RuntimeError):
    def __init__(
        self,
        reason: CommissionRefusal,
        message: str,
        *,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds


def _envelope() -> SignedEnvelope:
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        raise CommissionRefused("no_envelope", "this turn carries no signed request context")
    return SignedEnvelope(header=header, signature=signature)


def _payload(
    project_id: str,
    question: str,
    context: str | None,
    *,
    data_sources: list[str] | None = None,
    documents: PlanDocuments | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "op": "research",
        "projectId": project_id,
        "question": " ".join(question.split())[:MAX_QUESTION_CHARS],
    }
    settled = (context or "").strip()
    if settled:
        payload["context"] = settled[:MAX_CONTEXT_CHARS]
    if data_sources is not None:
        payload["dataSources"] = list(data_sources)
    if documents is not None and not documents.is_empty():
        payload["documents"] = documents.model_dump(exclude_none=True)
    return payload


def _refusal_from(error: DelegationError) -> CommissionRefused:
    if error.status == 403 and error.code == CONVERSATION_CONFINED_CODE:
        return CommissionRefused("confined", str(error))
    if error.status in (403, 404):
        return CommissionRefused("forbidden", str(error))
    if error.status == 429:
        return CommissionRefused("busy", str(error))
    return CommissionRefused("unreachable", str(error))


async def commission_research_run(
    question: str,
    *,
    context: str | None = None,
    data_sources: list[str] | None = None,
    documents: PlanDocuments | None = None,
) -> CommissionedRun:
    project_id = project_context.get_project_id_from_context()
    if not project_id:
        raise CommissionRefused("no_project", "this conversation is not in a project")
    envelope = _envelope()

    try:
        body = await asyncio.to_thread(
            post_task,
            _payload(project_id, question, context, data_sources=data_sources, documents=documents),
            envelope,
        )
    except DelegationError as exc:
        logger.info("Research run refused by the task API: %s", exc)
        raise _refusal_from(exc) from exc

    run_id = body.get("runId")
    conversation_id = body.get("conversationId")
    if not isinstance(run_id, str) or not run_id or not isinstance(conversation_id, str):
        raise CommissionRefused("unreachable", "the task API answered without a run")
    message_id = body.get("runMessageId")
    return CommissionedRun(
        run_id=run_id,
        run_message_id=message_id if isinstance(message_id, str) and message_id else None,
        conversation_id=conversation_id,
    )
