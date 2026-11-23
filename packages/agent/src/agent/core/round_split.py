from __future__ import annotations

import logging
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Any

from langchain_core.messages import ToolMessage

from agent.common.data_sources import disabled_source_notice
from agent.common.retrieval_rounds import repeat_fetches
from agent.common.retrieval_rounds import signatures_of
from agent.common.steering import HELD_FOR_STEER
from agent.common.steering import is_write_call
from agent.common.tool_calls import fetch_signature
from agent.common.turn_notices import emit_refused_source
from agent.common.turn_notices import emit_repeat_fetch
from agent.common.turn_notices import emit_width_cap

from .models import ResearchAgentState

logger = logging.getLogger(__name__)

_REPEAT_FETCH_PREFIX = (
    "Repeated call: this call already ran identically in this turn and was not executed "
    "again. Below is its earlier result, unchanged — continue with a different place "
    "or a different question."
)

_REPEAT_FETCH_MESSAGE = (
    "Not executed: this call already ran identically in this turn; "
    "the result above is the answer — continue with a different place or a different question, "
    "not with a repetition"
)

_FAILED_FETCH_REPEAT_MESSAGE = (
    "Not executed: this call was already included once in this round, and that first "
    "attempt failed — there is no result. You can make it again in the next round "
    "or choose a different place."
)

_WIDTH_CAP_MESSAGE = (
    "Not executed: this round requested more parallel calls than a round may "
    "run. The first calls of the round ran; this one did not. Make it again in the next "
    "round if you still need it after the results above."
)


def _call_name(call: Any) -> str:
    name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
    return str(name or "")


def _call_args(call: Any) -> Any:
    return call.get("args") if isinstance(call, dict) else getattr(call, "args", None)


def _over_width(running: Sequence[Any], max_calls: int) -> list[Any]:
    if max_calls <= 0 or len(running) <= max_calls:
        return []
    return list(running[max_calls:])


def _withheld_calls(
    calls: Sequence[Any],
    state: ResearchAgentState,
    disabled: frozenset[str],
    max_calls: int = 0,
) -> tuple[list[Any], list[tuple[Any, str]], list[Any]]:
    repeats = repeat_fetches(calls, state.executed_fetches)
    seen = {id(call) for call in repeats}
    refused = [
        (call, sentence)
        for call in calls
        if id(call) not in seen
        and (sentence := disabled_source_notice(_call_name(call), disabled, _call_args(call))) is not None
    ]
    seen |= {id(call) for call, _ in refused}
    over_width = _over_width([call for call in calls if id(call) not in seen], max_calls)
    return repeats, refused, over_width


def _drop_withheld(
    calls: list[Any],
    state: ResearchAgentState,
    disabled: frozenset[str],
    max_calls: int = 0,
) -> list[Any]:
    repeats, refused, over_width = _withheld_calls(calls, state, disabled, max_calls)
    if repeats:
        emit_repeat_fetch(round_index=state.retrieval_round, withheld=len(repeats))
        logger.info(
            "Duplicate fetch withheld: %d call(s) answered with the earlier result, %d asked for (round=%d)",
            len(repeats),
            len(calls),
            state.retrieval_round,
        )
    if refused:
        emit_refused_source(round_index=state.retrieval_round, withheld=len(refused))
        logger.info(
            "Disabled source: %d call(s) answered with the refusal notice (round=%d)",
            len(refused),
            state.retrieval_round,
        )
    if over_width:
        emit_width_cap(
            round_index=state.retrieval_round,
            kept=max_calls,
            withheld=len(over_width),
        )
        logger.warning(
            "Round width cap: %d of %d call(s) run, %d deferred to the next round (cap=%d, round=%d)",
            max_calls,
            len(calls),
            len(over_width),
            max_calls,
            state.retrieval_round,
        )
    withheld = {id(call) for call in (*repeats, *(call for call, _ in refused), *over_width)}
    if not withheld:
        return calls
    return [call for call in calls if id(call) not in withheld]


def _last_tool_calls(state: ResearchAgentState) -> list[dict[str, Any]]:
    last = state.messages[-1] if state.messages else None
    return [call for call in (getattr(last, "tool_calls", None) or []) if isinstance(call, dict)]


def _without_dropped_calls(state: ResearchAgentState, dropped: Sequence[Any]) -> ResearchAgentState:
    withheld = {id(call) for call in dropped}
    last = state.messages[-1]
    kept = [call for call in (getattr(last, "tool_calls", None) or []) if id(call) not in withheld]
    trimmed = last.model_copy(update={"tool_calls": kept})
    return state.model_copy(update={"messages": [*state.messages[:-1], trimmed]})


def _notice(call: Any, content: str) -> ToolMessage:
    return ToolMessage(
        content=content,
        name=_call_name(call),
        tool_call_id=str(call.get("id") or ""),
    )


def _repeat_answer(call: Any, results: Mapping[str, str], attempted: frozenset[str] = frozenset()) -> str:
    signature = fetch_signature(call)
    cached = results.get(signature) if signature is not None else None
    if cached:
        return f"{_REPEAT_FETCH_PREFIX}\n\n{cached}"
    if signature is not None and signature in attempted:
        return _FAILED_FETCH_REPEAT_MESSAGE
    return _REPEAT_FETCH_MESSAGE


@dataclass(frozen=True)
class _RoundSplit:
    ran: list[Any]
    repeats: list[Any]
    refused: list[tuple[Any, str]]
    over_width: list[Any]
    steered: list[Any] = field(default_factory=list)

    @property
    def withheld(self) -> list[Any]:
        return [*self.repeats, *(call for call, _ in self.refused), *self.over_width, *self.steered]

    def held_for_steer(self) -> _RoundSplit:
        steered = [call for call in self.ran if is_write_call(call)]
        if not steered:
            return self
        held = {id(call) for call in steered}
        return replace(self, ran=[call for call in self.ran if id(call) not in held], steered=steered)

    @property
    def attempted(self) -> frozenset[str]:
        return signatures_of(self.ran)

    def notices(self, results: Mapping[str, str]) -> list[ToolMessage]:
        attempted = self.attempted
        return [
            *(_notice(call, _repeat_answer(call, results, attempted)) for call in self.repeats),
            *(_notice(call, sentence) for call, sentence in self.refused),
            *(_notice(call, _WIDTH_CAP_MESSAGE) for call in self.over_width),
            *(_notice(call, HELD_FOR_STEER) for call in self.steered),
        ]


def _split_round(state: ResearchAgentState, disabled: frozenset[str], max_calls: int = 0) -> _RoundSplit:
    calls = _last_tool_calls(state)
    repeats, refused, over_width = _withheld_calls(calls, state, disabled, max_calls)
    withheld = {id(call) for call in (*repeats, *(call for call, _ in refused), *over_width)}
    return _RoundSplit(
        ran=[call for call in calls if id(call) not in withheld],
        repeats=repeats,
        refused=refused,
        over_width=over_width,
    )


def _fetch_results(
    ran: Sequence[Any],
    messages: Sequence[Any],
    failed_ids: set[str],
) -> dict[str, str]:
    by_id = {
        str(getattr(message, "tool_call_id", "") or ""): str(message.content or "")
        for message in messages
        if isinstance(message, ToolMessage)
    }
    results: dict[str, str] = {}
    for call in ran:
        call_id = str(call.get("id") or "")
        signature = fetch_signature(call)
        content = by_id.get(call_id)
        if call_id in failed_ids or signature is None or not content:
            continue
        results[signature] = content
    return results
