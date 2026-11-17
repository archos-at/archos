from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any
from typing import Protocol
from typing import TypeVar
from typing import get_args

from agent.common.cost_tracking import BudgetExceededError
from agent.common.cost_tracking import track_llm_costs
from agent.common.profiler import annotate_current_span
from agent.common.profiler import profiled_span
from agent.common.provider_limiter import CHAT
from agent.common.provider_limiter import provider_class
from agent.common.turn_admission import TurnAdmissionError
from agent.common.turn_admission import admit_turn_async
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import TurnResult
from agent.observability.turn_phases import observed_phase

logger = logging.getLogger(__name__)

PROFILE_AGENT_NAME = "chat_researcher"

StateT = TypeVar("StateT")


_BODIES = get_args(EventBody)


class AnsweringAgent(Protocol[StateT]):
    def stream(self, state: StateT, thread_id: str | None = None) -> AsyncIterator[EventBody | StateT]: ...


async def spanned[T](name: str, awaitable: Awaitable[T]) -> T:
    with profiled_span(name), observed_phase(name) as outcome:
        result = await awaitable
        outcome.update(getattr(result, "phase_facts", None) or {})
        return result


@dataclass(frozen=True)
class TurnRefusal:

    message: str
    retry_after_seconds: int | None = None
    outcome: str = "refused"


@dataclass(frozen=True)
class TurnOutcome[StateT]:

    state: StateT | None
    refusal: TurnRefusal | None


@dataclass
class TurnLedgers:

    cost_tracker: Any = None


async def _enter_admission_slot(
    admission: contextlib.AsyncExitStack, organization_id: str | None
) -> TurnAdmissionError | None:
    with profiled_span("admission.wait"), observed_phase("admission.wait"):
        try:
            await admission.enter_async_context(admit_turn_async(organization_id))
        except TurnAdmissionError as refused:
            annotate_current_span(refused=True)
            return refused
    return None


async def answer_turn[StateT](
    agent: AnsweringAgent[StateT],
    state: StateT,
    *,
    thread_id: str,
    organization_id: str | None,
    identity: dict[str, str | None] | None = None,
    metadata: dict[str, Any] | None = None,
    ledgers: TurnLedgers | None = None,
) -> AsyncIterator[EventBody | TurnOutcome[StateT]]:
    published = ledgers if ledgers is not None else TurnLedgers()
    refusal: TurnRefusal | None = None
    final: StateT | None = None
    try:
        async with contextlib.AsyncExitStack() as admission:
            admission.enter_context(provider_class(CHAT))
            refused = await _enter_admission_slot(admission, organization_id)
            if refused is not None:
                raise refused
            with track_llm_costs(identity=identity, inline_flush=False) as cost_tracker:
                published.cost_tracker = cost_tracker
                async with contextlib.aclosing(agent.stream(state, thread_id=thread_id)) as items:
                    async for item in items:
                        if isinstance(item, _BODIES):
                            yield item
                        else:
                            final = item
    except TurnAdmissionError as error:
        logger.warning("Turn refused by admission control: %s", error)
        refusal = TurnRefusal(str(error), error.retry_after_seconds, outcome="admission_refused")
    except BudgetExceededError as error:
        logger.warning("Turn stopped by budget enforcement: %s", error)
        refusal = TurnRefusal(str(error), outcome="budget_exceeded")
    if refusal is None:
        yield TurnOutcome(state=final, refusal=None)
        return
    if metadata is not None:
        metadata["outcome"] = refusal.outcome
    yield TurnOutcome(state=None, refusal=refusal)


def refused(refusal: TurnRefusal, *, message_id: str) -> RunFinishedBody:
    result = TurnResult(message_id=message_id, text=refusal.message, retry_after_seconds=refusal.retry_after_seconds)
    return RunFinishedBody(outcome="refused", result=result)
