"""A stage's frame, stored on its answer by this tier rather than by the browser alone.

The frame reaches the message row through the browser that receives it
(``_persistStageOutput`` in the chat stores), so it is lost when no browser is
attached when the stage ends: the person opened another chat, or closed the
tab. For a stage that SAVES something the reader was promised to see under the
answer (memory reflection), that loss breaks the promise, so the stage also
hands its payload to ``PATCH /api/internal/conversations/{id}/messages/{answer}/stages``.
The BFF stores it with the browser path's sanitiser and merge, so the two
writers converge and either may land first (post-answer-stages §11 risk 3).

The write is detached from the stage: it never delays the frame, never counts
against the stage's timeout, and never fails it. The answer row is written by
the agent host in the background, possibly after the stage, so a 404 is retried
on :data:`RETRY_DELAYS_S` and then given up with a named reason, in the log and
on a profiler span (``stage:<id>:durable``, outcome ``stored`` or ``gave_up``). The notes themselves are already
stored by then; what is lost is only their place under the answer.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from agent.common import bff_http
from agent.stages.spec import TurnFacts

logger = logging.getLogger(__name__)

#: Between attempts while the answer row is not there yet: about fifteen seconds
#: in all, longer than the agent host's background persist takes in practice.
RETRY_DELAYS_S: tuple[float, ...] = (1.0, 2.0, 4.0, 8.0)
_REQUEST_TIMEOUT_S = 5.0

#: Strong references, so a detached write is not collected mid-flight.
_pending: set[asyncio.Task[str]] = set()

#: Tests replace it to skip the wait.
_sleep = asyncio.sleep


def stages_path(conversation_id: str, message_id: str) -> str:
    """The internal route that stores a stage's frame on one answer."""
    return f"/api/internal/conversations/{conversation_id}/messages/{message_id}/stages"


def schedule_durable_frame(facts: TurnFacts, stage_id: str, payload: dict[str, Any]) -> asyncio.Task[str] | None:
    """Start storing ``payload`` on the turn's answer, detached. Never raises.

    ``None`` when the turn cannot be addressed (no envelope, off the chat
    socket); that is recorded as the outcome instead.
    """
    try:
        missing = _missing_identity(facts)
        if missing:
            # No span: a turn without an envelope or off the socket has no
            # answer to address, which is the turn's fact, not this write's.
            logger.info("Durable frame of stage %s not written: %s", stage_id, missing)
            return None
        from agent.turn.response import answer_message_id

        task = asyncio.get_running_loop().create_task(
            _write_and_record(facts, stage_id, answer_message_id(facts.conversation_id, facts.ws_parent_id), payload)
        )
    except Exception:
        logger.warning("Could not start the durable write of stage %s", stage_id, exc_info=True)
        return None
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    return task


def _missing_identity(facts: TurnFacts) -> str | None:
    if not facts.conversation_id or not facts.ws_parent_id:
        return "no_turn"
    if facts.envelope is None:
        return "no_envelope"
    return None


async def _write_and_record(facts: TurnFacts, stage_id: str, message_id: str, payload: dict[str, Any]) -> str:
    attempts, reason = await write_durable_frame(facts, stage_id, message_id, payload)
    outcome = "stored" if reason == "stored" else "gave_up"
    # Off the loop: the span is posted to the BFF synchronously.
    await asyncio.to_thread(_record, facts, stage_id, outcome, reason, attempts=attempts)
    return reason


async def write_durable_frame(
    facts: TurnFacts, stage_id: str, message_id: str, payload: dict[str, Any]
) -> tuple[int, str]:
    """``(attempts, reason)``: ``stored``, or why it gave up. Never raises.

    Retried: a 404 (the answer row is not written yet) and a request that did
    not complete. Final: any other refusal, and a missing service token.
    """
    missing = _missing_identity(facts)
    if missing or facts.envelope is None or not facts.conversation_id:
        return 0, missing or "no_envelope"
    path = stages_path(facts.conversation_id, message_id)
    body = {"stage": stage_id, "payload": payload}
    headers = facts.envelope.headers()
    reason = "unknown"
    for attempt in range(1, len(RETRY_DELAYS_S) + 2):
        if attempt > 1:
            await _sleep(RETRY_DELAYS_S[attempt - 2])
        reason, final = await _attempt(stage_id, path, body, headers)
        if final:
            return attempt, reason
    return len(RETRY_DELAYS_S) + 1, reason


async def _attempt(stage_id: str, path: str, body: dict[str, Any], headers: dict[str, str]) -> tuple[str, bool]:
    """One write: ``(reason, final)``. Not final means the next attempt may succeed."""
    try:
        await asyncio.to_thread(bff_http.send, "PATCH", path, timeout=_REQUEST_TIMEOUT_S, body=body, headers=headers)
    except bff_http.BffNotConfiguredError:
        return "not_configured", True
    except bff_http.BffRefusedError as exc:
        # A 404 is the answer row not written yet; any other refusal will not change.
        return ("answer_not_found", False) if exc.status == 404 else (f"refused_{exc.status}", True)
    except bff_http.BffError:
        return "unreachable", False
    except Exception:  # noqa: BLE001 - a durable copy is worth less than the stage
        logger.warning("Durable write of stage %s failed", stage_id, exc_info=True)
        return "error", True
    return "stored", True


def _record(facts: TurnFacts, stage_id: str, outcome: str, reason: str, *, attempts: int) -> None:
    """The outcome, in the log and on one profiler span. Never raises."""
    level = logging.INFO if outcome == "stored" else logging.WARNING
    logger.log(
        level,
        "Durable frame of stage %s for conversation %s: %s (%s, %d attempt(s))",
        stage_id,
        facts.conversation_id,
        outcome,
        reason,
        attempts,
    )
    try:
        from agent.common.profiler import track_agent_profile

        metadata = {"stage": stage_id, "outcome": outcome, "reason": reason, "attempts": attempts}
        identity = {"organization_id": facts.organization_id, "conversation_id": facts.conversation_id}
        with track_agent_profile(agent_name=f"stage:{stage_id}:durable", identity=identity, metadata=metadata):
            pass
    except Exception:
        logger.warning("Could not record the durable-frame span for stage %s", stage_id, exc_info=True)
