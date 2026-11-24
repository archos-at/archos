from __future__ import annotations

import logging
import time

from agent.common.steering import AppliedSteer
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.steering import current_steer_inbox
from agent.common.steering import render_note
from agent.common.turn_notices import emit_steered_writes
from agent.common.turn_status import emit
from agent.common.wire_v2 import SteerAppliedBody
from agent.common.wire_v2 import SteerAppliedValue
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.retrieval_trace import emit_step_span
from agent.observability.turn_outcome import record_turn_facts

from .models import ResearchAgentState
from .round_split import _RoundSplit

logger = logging.getLogger(__name__)

STEERED_TAG = "steered"


def _steer_round(state: ResearchAgentState) -> int:
    return state.tool_iterations + 1


def _announce_steer(note: SteerNote, applied: AppliedSteer, inbox: SteerInbox) -> None:
    emit(SteerAppliedBody(value=SteerAppliedValue(steer_id=note.steer_id, round=applied.round)))
    waited_ms = max(0, int((time.monotonic() - note.received_at) * 1000))
    emit_step_span(
        "turn.steer",
        {
            "round": applied.round,
            "chars": len(note.text),
            "waited_ms": waited_ms,
            "region": note.focus_region is not None,
        },
        {"applied": True, "at": applied.at},
    )
    add_trace_tag(STEERED_TAG)
    record_turn_facts(steer_count=len(inbox.applied))


def _take_steering(state: ResearchAgentState) -> list[AppliedSteer] | None:
    inbox = current_steer_inbox()
    if inbox is None or not inbox.has_pending():
        return None
    round_index = _steer_round(state)
    at = len(state.messages)
    taken = inbox.take()
    new = [
        AppliedSteer(steer_id=note.steer_id, content=render_note(note, round_index), at=at, round=round_index)
        for note in taken
    ]
    for note, applied in zip(taken, new, strict=True):
        _announce_steer(note, applied, inbox)
    logger.info("Steering: %d note(s) read before round %d", len(new), round_index)
    return [*state.steering, *new]


def _hold_writes_for_steer(state: ResearchAgentState, split: _RoundSplit) -> _RoundSplit:
    inbox = current_steer_inbox()
    if inbox is None or not inbox.has_pending():
        return split
    held = split.held_for_steer()
    if held.steered:
        emit_steered_writes(round_index=state.retrieval_round, withheld=len(held.steered))
        logger.info("Steering: %d write call(s) held back for a note that arrived after them", len(held.steered))
    return held
