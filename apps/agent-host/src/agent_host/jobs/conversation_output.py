from __future__ import annotations

import logging
import uuid
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any

from agent.observability.turn_trace import TRACE_ID_METADATA_KEY

from ..internal_api import post_internal_conversation_message
from ..internal_api import post_internal_run_report

logger = logging.getLogger(__name__)

_JOB_MESSAGE_NAMESPACE = uuid.NAMESPACE_URL

FAILURE_NOTICE = (
    "Dieser Job wurde ausgeführt, hat aber kein Ergebnis geliefert. "
    "Den Status und die Fehlermeldung finden Sie im Ausführungsverlauf des Jobs."
)
INTERRUPTED_NOTICE = (
    "Dieser Job wurde abgebrochen, bevor ein Ergebnis vorlag. Den Status finden Sie im Ausführungsverlauf des Jobs."
)


_TRANSPARENCY_METADATA_KEYS = (
    "research_truncated",
    "truncation_reason",
    "degraded_reasons",
    "citations_removed",
    "answer_confidence",
    "answer_confidence_reason",
    "answer_confidence_capped_reason",
    "answer_meta",
    "findings",
    "retrieval_ledger",
    "skills_hidden",
    "stages",
)


def _transparency_metadata(transparency: dict[str, Any] | None) -> dict[str, Any]:
    if not transparency:
        return {}

    metadata: dict[str, Any] = {}
    for key in _TRANSPARENCY_METADATA_KEYS:
        value = transparency.get(key)
        if isinstance(value, bool):
            if value:
                metadata[key] = True
            continue
        if not value:
            continue
        metadata[key] = value
    return metadata


def _message_id(conversation_id: str, job_id: str, role: str) -> str:
    return str(uuid.uuid5(_JOB_MESSAGE_NAMESPACE, f"grid:job:{conversation_id}:{job_id}:{role}"))


def report_message_id(conversation_id: str | None, job_id: str) -> str | None:
    if not conversation_id:
        return None
    return _message_id(conversation_id, job_id, "assistant")


def _answer_metadata(
    *,
    job_id: str,
    cards: list[Any] | None,
    skills_activated: list[str] | None,
    sources: list[Any] | None,
    transparency: dict[str, Any] | None,
    trace_id: str | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {"job_id": job_id}
    if trace_id:
        metadata[TRACE_ID_METADATA_KEY] = trace_id
    if cards:
        metadata["cards"] = cards
    metadata["deep_research_job_id"] = job_id
    if skills_activated:
        metadata["skills_activated"] = list(skills_activated)
    if sources:
        metadata["sources"] = list(sources)
    try:
        metadata.update(_transparency_metadata(transparency))
    except Exception:  # noqa: BLE001 — best-effort by contract; see module docstring
        logger.warning(
            "Could not attach answer transparency to the thread message for job %s (non-fatal)",
            job_id,
            exc_info=True,
        )
    return metadata


async def _write_into_run_message(
    *, job_id: str, text: str, metadata: dict[str, Any], expect_run: bool = False
) -> str | None:
    try:
        return await post_internal_run_report(job_id=job_id, text=text, metadata=metadata, expect_run=expect_run)
    except Exception:  # noqa: BLE001 — best-effort by contract; see module docstring
        logger.warning("Could not write into the run message for job %s (non-fatal)", job_id, exc_info=True)
        return None


def _organization_id(usage_context: dict | None) -> str | None:
    return ((usage_context or {}).get("identity") or {}).get("organization_id")


async def write_job_turn(
    *,
    conversation_id: str | None,
    job_id: str,
    usage_context: dict | None,
    prompt: str,
    answer: str,
    cards: list[Any] | None = None,
    skills_activated: list[str] | None = None,
    sources: list[Any] | None = None,
    transparency: dict[str, Any] | None = None,
    expect_run: bool = False,
    trace_id: str | None = None,
) -> str | None:
    metadata = _answer_metadata(
        job_id=job_id,
        cards=cards,
        skills_activated=skills_activated,
        sources=sources,
        transparency=transparency,
        trace_id=trace_id,
    )

    landed = await _write_into_run_message(job_id=job_id, text=answer, metadata=metadata, expect_run=expect_run)
    if landed is not None:
        return landed

    if not conversation_id:
        return None

    organization_id = _organization_id(usage_context)
    if not organization_id:
        logger.warning(
            "Job %s has a conversation but no organization id; skipping the conversation write",
            job_id,
        )
        return None

    now = datetime.now(UTC)
    asked_at = (now - timedelta(seconds=1)).isoformat()

    try:
        await post_internal_conversation_message(
            conversation_id=conversation_id,
            organization_id=organization_id,
            message_id=_message_id(conversation_id, job_id, "user"),
            role="user",
            text=prompt,
            message_type="user_message",
            created_at=asked_at,
        )
        await post_internal_conversation_message(
            conversation_id=conversation_id,
            organization_id=organization_id,
            message_id=_message_id(conversation_id, job_id, "assistant"),
            role="assistant",
            text=answer,
            message_type="agent_response",
            metadata=metadata,
            created_at=now.isoformat(),
        )
    except Exception:  # noqa: BLE001 — best-effort by contract; see module docstring
        logger.warning(
            "Failed to write the conversation turn for job %s",
            job_id,
            exc_info=True,
        )
        return None
    return report_message_id(conversation_id, job_id)


async def write_job_notice(
    *,
    conversation_id: str | None,
    job_id: str,
    usage_context: dict | None,
    notice: str,
    expect_run: bool = False,
) -> None:
    notice_metadata = {"job_id": job_id}
    if (
        await _write_into_run_message(job_id=job_id, text=notice, metadata=notice_metadata, expect_run=expect_run)
        is not None
    ):
        return

    if not conversation_id:
        return

    organization_id = _organization_id(usage_context)
    if not organization_id:
        return

    try:
        await post_internal_conversation_message(
            conversation_id=conversation_id,
            organization_id=organization_id,
            message_id=_message_id(conversation_id, job_id, "notice"),
            role="assistant",
            text=notice,
            message_type="agent_response",
            metadata={"job_id": job_id},
        )
    except Exception:  # noqa: BLE001 — best-effort by contract
        logger.warning("Failed to write the failure notice for job %s", job_id, exc_info=True)


def run_message_for_outcome(
    *,
    job_id: str,
    status: str,
    output: dict[str, Any] | None,
) -> dict[str, Any] | None:
    normalized = status.lower()
    if normalized == "success":
        output = output or {}
        report = output.get("report")
        if not isinstance(report, str) or not report:
            return None
        cards = output.get("cards")
        sources = output.get("sources")
        metadata = _answer_metadata(
            job_id=job_id,
            cards=cards if isinstance(cards, list) else None,
            skills_activated=None,
            sources=sources if isinstance(sources, list) else None,
            transparency=output,
        )
        return {"content": report, "metadata": metadata}
    if normalized == "failure":
        return {"content": FAILURE_NOTICE, "metadata": {"job_id": job_id}}
    if normalized == "interrupted":
        return {"content": INTERRUPTED_NOTICE, "metadata": {"job_id": job_id}}
    return None
