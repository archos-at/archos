from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from typing import Final

from agent.common.cost_tracking import BudgetExceededError
from agent.observability import posthog_client

PROVIDER_CREDITS: Final = "provider_credits"
TIMEOUT: Final = "timeout"
BUDGET: Final = "budget"
PROVIDER_ERROR: Final = "provider_error"
WORKFLOW_ERROR: Final = "workflow_error"

_TIMEOUT_NAMES = frozenset({"TimeoutError", "APITimeoutError", "ReadTimeout", "TurnDeadlineExceeded"})


def _chain(exc: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def _status_of(error: BaseException) -> object:
    return getattr(error, "status_code", None) or getattr(getattr(error, "response", None), "status_code", None)


def reason_for(exc: BaseException) -> str:
    reasons: set[str] = set()
    for error in _chain(exc):
        status = _status_of(error)
        if status == 402:
            return PROVIDER_CREDITS
        if isinstance(error, BudgetExceededError):
            reasons.add(BUDGET)
        elif {cls.__name__ for cls in type(error).__mro__} & _TIMEOUT_NAMES:
            reasons.add(TIMEOUT)
        elif isinstance(status, int) and status >= 400:
            reasons.add(PROVIDER_ERROR)
    for reason in (BUDGET, TIMEOUT, PROVIDER_ERROR):
        if reason in reasons:
            return reason
    return WORKFLOW_ERROR


def reason_for_text(text: str | None) -> str:
    lowered = (text or "").lower()
    if "402" in lowered and ("credit" in lowered or "payment" in lowered) or "insufficient credits" in lowered:
        return PROVIDER_CREDITS
    if "turn_deadline_exceeded" in lowered or "timed out" in lowered:
        return TIMEOUT
    if "budget" in lowered:
        return BUDGET
    return WORKFLOW_ERROR


def capture_answer_failed(
    *,
    message_id: str | None,
    reason: str,
    distinct_id: str | None,
    organization_id: str | None = None,
    error_type: str | None = None,
    conversation_id: str | None = None,
) -> None:
    properties = {
        "message_id": message_id,
        "conversation_id": conversation_id,
        "reason": reason,
        "error_type": error_type,
        "organization_id": organization_id,
    }
    posthog_client.capture(
        "answer_failed",
        distinct_id=distinct_id,
        properties={key: value for key, value in properties.items() if value is not None},
    )


CREDITS_MESSAGE: Final = (
    "The AI provider is temporarily at capacity, so no answer could be produced. Please ask again in a minute."
)


def report_turn_failed(turn: Any, reason: str, error_type: str | None = None) -> None:
    capture_answer_failed(
        message_id=turn.message_id,
        reason=reason,
        distinct_id=turn.asker_subject,
        organization_id=turn.organization_id,
        error_type=error_type,
        conversation_id=turn.wire.conversation_id,
    )
