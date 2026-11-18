from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from agent.common import content_to_text
from agent.common.retrieval_rounds import assistant_checkpoint
from agent.common.retrieval_status import emit_retrieval
from agent.common.retrieval_status import record_round_announcement
from agent.common.tool_calls import is_retrieval_round
from agent.common.tool_calls import is_skill_read
from agent.common.tool_calls import tool_basename

from .models import ResearchAgentState
from .round_split import _drop_withheld

logger = logging.getLogger(__name__)

SKILL_READ_SHAPE = "read_skill"


def _call_basenames(message: Any) -> list[str]:
    names: list[str] = []
    for call in getattr(message, "tool_calls", None) or []:
        name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
        if name:
            names.append(SKILL_READ_SHAPE if is_skill_read(call) else tool_basename(str(name)))
    return names


def _tool_call_shape(messages: Sequence[Any], *, limit: int = 24) -> list[str]:
    shape: list[str] = []
    for message in messages:
        shape.extend(_call_basenames(message))
        if len(shape) >= limit:
            return shape[:limit]
    return shape


def _starts_synthesis(response: Any, state: ResearchAgentState) -> bool:
    calls = getattr(response, "tool_calls", None) or []
    if calls:
        return False
    text = " ".join(content_to_text(getattr(response, "content", "") or "").split())
    if not text:
        return False
    return state.tool_iterations > 0


def _charge_empty_round(state: ResearchAgentState, ceiling: int) -> tuple[int, int, dict[str, Any] | None]:
    rounds = state.tool_iterations + 1
    logger.info(
        "Round withheld in full (repeat or switched-off source); charged 1 round. Rounds spent: %d/%d",
        rounds,
        ceiling,
    )
    return rounds, state.retrieval_round, None


def _charge_tool_calls(
    response: Any,
    state: ResearchAgentState,
    ceiling: int,
    disabled: frozenset[str] = frozenset(),
    max_calls: int = 0,
) -> tuple[int, int, dict[str, Any] | None]:
    calls = getattr(response, "tool_calls", None) or []
    if not calls:
        return state.tool_iterations, state.retrieval_round, None
    calls = _drop_withheld(calls, state, disabled, max_calls)
    if not calls:
        return _charge_empty_round(state, ceiling)
    rounds = state.tool_iterations + 1
    logger.info(
        "Round of %d tool call(s). Rounds spent: %d/%d",
        len(calls),
        rounds,
        ceiling,
    )
    conclusion = assistant_checkpoint(response)
    searched = emit_retrieval(
        calls,
        round_index=state.retrieval_round,
        conclusion=conclusion,
    )
    retrieval_round = state.retrieval_round + (1 if searched else 0)
    record = record_round_announcement(
        round_index=state.retrieval_round,
        calls=calls,
        conclusion=conclusion,
    )
    return rounds, retrieval_round, record


def _executing_retrieval_round(state: ResearchAgentState, ran: Sequence[Any]) -> int | None:
    calls = [call for call in ran if isinstance(call, dict)]
    if not is_retrieval_round(calls):
        return None
    return max(state.retrieval_round - 1, 0)
