from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Protocol

from agent.common import get_latest_user_query
from agent.turn.commission import CommissionedRun
from agent.turn.commission import commission_research_run

if TYPE_CHECKING:
    from agent.agents.piloti.models import ConversationState

logger = logging.getLogger(__name__)

RunCommissioner = Callable[["ConversationState"], Awaitable[CommissionedRun]]


class DispatchSettings(Protocol):

    use_async_deep_research: bool
    memory_reflection_llm: str | None


def job_query(state: ConversationState) -> str:
    query = state.original_query or (get_latest_user_query(state.messages) if state.messages else None)
    if not query:
        raise RuntimeError("Cannot submit deep research job without a query.")
    return query if isinstance(query, str) else str(query)


def build_run_commissioner(config: DispatchSettings) -> RunCommissioner | None:
    if not config.use_async_deep_research:
        return None
    logger.info("An escalated question is commissioned as a research run")

    async def _commission(state: ConversationState) -> CommissionedRun:
        return await commission_research_run(
            job_query(state),
            context=state.clarifier_result,
            data_sources=state.data_sources,
            documents=state.plan_documents,
        )

    return _commission
