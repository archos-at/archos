from __future__ import annotations

import asyncio
import uuid

from agent.observability.turn_trace import TRACE_ID_METADATA_KEY
from agent.observability.turn_trace import current_trace_id_hex
from agent.observability.turn_trace import pinned_trace
from agent.observability.turn_trace import trace_id_for_message
from agent.observability.turn_trace import trace_id_hex
from agent.turn.response import answer_message_id
from nat.plugin_api import ContextState


def test_an_answer_id_is_its_own_trace_id():
    message_id = answer_message_id("conv-1", "turn-1")
    trace_id = trace_id_for_message(message_id)

    assert trace_id == uuid.UUID(message_id).int
    assert trace_id_hex(trace_id) == uuid.UUID(message_id).hex
    assert len(trace_id_hex(trace_id)) == 32


def test_a_non_uuid_id_pins_nothing():
    for message_id in (None, "", "m-1", "not-a-uuid", str(uuid.UUID(int=0))):
        assert trace_id_for_message(message_id) is None
    assert trace_id_hex(None) is None
    assert trace_id_hex(0) is None
    assert trace_id_hex(1 << 128) is None


def test_the_hex_is_zero_padded():
    assert trace_id_hex(1) == "0" * 31 + "1"


async def test_the_pin_is_what_nat_and_its_child_tasks_see_and_is_undone_after():
    state = ContextState.get()
    before = state.workflow_trace_id.get()
    trace_id = trace_id_for_message(answer_message_id("conv-1", "turn-1"))

    with pinned_trace(trace_id):
        assert state.workflow_trace_id.get() == trace_id
        assert current_trace_id_hex() == trace_id_hex(trace_id)
        assert await asyncio.create_task(_read_trace_id()) == trace_id

    assert state.workflow_trace_id.get() == before


async def _read_trace_id() -> int | None:
    return ContextState.get().workflow_trace_id.get()


def test_no_pin_without_an_id():
    state = ContextState.get()
    before = state.workflow_trace_id.get()
    with pinned_trace(None):
        assert state.workflow_trace_id.get() == before


def test_the_metadata_key_is_the_one_the_bff_reads():
    assert TRACE_ID_METADATA_KEY == "trace_id"
