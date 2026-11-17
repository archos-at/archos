from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from agent.common.content_screen import DETECTORS_ONLY
from agent.common.content_screen import ScreeningRules
from agent.common.content_screen import is_screening_config
from agent_host.internal_retry import send_with_retry

logger = logging.getLogger(__name__)

_PERSIST_TIMEOUT_SECONDS = 10.0


def internal_base_url() -> str | None:
    return os.environ.get("FRONTEND_INTERNAL_URL") or os.environ.get("FRONTEND_URL")


INTERNAL_TOKEN_HEADER = "X-Internal-Token"


def internal_headers() -> dict[str, str] | None:
    token = os.environ.get("INTERNAL_API_TOKEN")
    if not token:
        return None
    return {"Content-Type": "application/json", INTERNAL_TOKEN_HEADER: token}


async def post_internal_conversation_message(
    *,
    conversation_id: str,
    organization_id: str | None,
    message_id: str,
    role: str,
    text: str,
    message_type: str,
    metadata: dict[str, Any] | None = None,
    created_at: str | None = None,
) -> bool:
    base_url = internal_base_url()
    if not base_url:
        logger.warning(
            "Cannot persist message for %s: FRONTEND_INTERNAL_URL/FRONTEND_URL not configured",
            conversation_id,
        )
        return False

    headers = internal_headers()
    if headers is None:
        logger.warning(
            "Cannot persist message for %s: INTERNAL_API_TOKEN not configured",
            conversation_id,
        )
        return False

    if not organization_id:
        logger.warning(
            "Cannot persist message for %s: organization id unavailable",
            conversation_id,
        )
        return False

    payload: dict[str, Any] = {
        "organizationId": organization_id,
        "id": message_id,
        "role": role,
        "content": text,
        "messageType": message_type,
        "metadata": metadata or {},
    }
    if created_at:
        payload["createdAt"] = created_at
    url = f"{base_url.rstrip('/')}/api/internal/conversations/{conversation_id}/messages"

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_PERSIST_TIMEOUT_SECONDS) as client:
            return await client.post(url, json=payload, headers=headers)

    response = await send_with_retry(_send, label=f"Server-side persist for conversation {conversation_id}")
    if response is None:
        logger.warning("Failed to persist %s message server-side for conversation %s", role, conversation_id)
        return False
    if response.status_code not in (200, 201):
        logger.warning(
            "Server-side persist for conversation %s returned HTTP %s",
            conversation_id,
            response.status_code,
        )
        return False
    logger.info("Persisted %s message server-side for conversation %s", role, conversation_id)
    return True


async def post_internal_run_report(
    *,
    job_id: str,
    text: str,
    metadata: dict[str, Any] | None = None,
    expect_run: bool = False,
) -> str | None:
    base_url = internal_base_url()
    headers = internal_headers()
    if not base_url or headers is None:
        logger.warning("Cannot write the run report for job %s: internal API not configured", job_id)
        return None

    url = f"{base_url.rstrip('/')}/api/internal/runs/by-job/{job_id}/report"
    payload: dict[str, Any] = {"content": text, "metadata": metadata or {}}

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_PERSIST_TIMEOUT_SECONDS) as client:
            return await client.post(url, json=payload, headers=headers)

    response = await send_with_retry(_send, label=f"Run report for job {job_id}", retry_not_found=expect_run)
    if response is None:
        logger.warning("Failed to write the run report for job %s", job_id)
        return None

    if response.status_code == 404:
        logger.debug("Job %s has no run message; the thread turn is written the old way", job_id)
        return None
    if response.status_code not in (200, 201):
        logger.warning("Run report for job %s returned HTTP %s", job_id, response.status_code)
        return None
    logger.info("Wrote the report into the run message for job %s", job_id)
    try:
        message_id = response.json().get("messageId")
    except Exception:  # noqa: BLE001 — the write happened; a missing id costs only the ledger's link
        message_id = None
    return message_id if isinstance(message_id, str) else ""


def turn_steps_path(conversation_id: str, turn_id: str) -> str:
    return f"/api/internal/conversations/{conversation_id}/messages/{turn_id}/steps"


async def post_internal_turn_steps(
    conversation_id: str, organization_id: str | None, turn_id: str, frames: Sequence[dict[str, Any]]
) -> bool:
    base_url = internal_base_url()
    headers = internal_headers()
    if not base_url or headers is None or not organization_id:
        logger.warning("Cannot store the Herleitung of turn %s: no internal API or organization", turn_id)
        return False
    url = f"{base_url.rstrip('/')}{turn_steps_path(conversation_id, turn_id)}"
    payload = {"organizationId": organization_id, "frames": list(frames)}

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_PERSIST_TIMEOUT_SECONDS) as client:
            return await client.put(url, json=payload, headers=headers)

    response = await send_with_retry(_send, label=f"Herleitung of turn {turn_id}")
    if response is None or response.status_code not in (200, 201):
        status = "no response" if response is None else f"HTTP {response.status_code}"
        logger.warning("Storing the Herleitung of turn %s failed: %s", turn_id, status)
        return False
    logger.info("Stored the Herleitung of turn %s of conversation %s", turn_id, conversation_id)
    return True


_OUTCOME_TIMEOUT_SECONDS = 5.0

TURN_OUTCOME_PATH = "/api/internal/turns/outcome"


async def post_internal_turn_outcome(
    *, conversation_id: str, turn_id: str, outcome: str, reason: str | None = None
) -> bool:
    base_url = internal_base_url()
    headers = internal_headers()
    if not base_url or headers is None:
        logger.warning("Cannot report the outcome of turn %s: internal API not configured", turn_id)
        return False
    payload: dict[str, Any] = {"conversationId": conversation_id, "turnId": turn_id, "outcome": outcome}
    if reason:
        payload["reason"] = reason
    url = f"{base_url.rstrip('/')}{TURN_OUTCOME_PATH}"

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_OUTCOME_TIMEOUT_SECONDS) as client:
            return await client.post(url, json=payload, headers=headers)

    response = await send_with_retry(_send, label=f"Outcome of turn {turn_id}")
    if response is None:
        logger.warning("Failed to report the outcome of turn %s of conversation %s", turn_id, conversation_id)
        return False
    if response.status_code not in (200, 201):
        logger.warning("The outcome of turn %s returned HTTP %s", turn_id, response.status_code)
        return False
    logger.info("Reported turn %s of conversation %s as %s", turn_id, conversation_id, outcome)
    return True


_CHAT_SCREENING_TIMEOUT_SECONDS = 3.0


@dataclass(frozen=True)
class ChatScreening:
    rules: ScreeningRules | None
    from_office: bool


CHAT_SCREENING_FALLBACK = ChatScreening(rules=DETECTORS_ONLY, from_office=False)


def chat_screening_from(body: object) -> ChatScreening:
    if not isinstance(body, dict) or not isinstance(body.get("enabled"), bool):
        return CHAT_SCREENING_FALLBACK
    if body["enabled"] is False:
        return ChatScreening(rules=None, from_office=True)
    if not is_screening_config(body):
        return CHAT_SCREENING_FALLBACK
    return ChatScreening(
        rules=ScreeningRules.build(body.get("content_terms") or [], body.get("detectors") or []),
        from_office=True,
    )


async def chat_screening_for(organization_id: str | None) -> ChatScreening:
    base_url = internal_base_url()
    headers = internal_headers()
    if not base_url or headers is None or not organization_id:
        logger.info("Chat screening uses every detector: no organization or internal API to ask")
        return CHAT_SCREENING_FALLBACK
    url = f"{base_url.rstrip('/')}/api/internal/chat-screening"
    try:
        async with httpx.AsyncClient(timeout=_CHAT_SCREENING_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params={"organizationId": organization_id}, headers=headers)
        body = response.json() if response.status_code == 200 else None
    except Exception:  # noqa: BLE001 — any failure screens with every detector; the reason is logged
        logger.warning("Reading the chat screening of organization %s failed", organization_id, exc_info=True)
        return CHAT_SCREENING_FALLBACK
    screening = chat_screening_from(body)
    if not screening.from_office:
        logger.warning("Chat screening uses every detector: the BFF answered HTTP %s", response.status_code)
    return screening
