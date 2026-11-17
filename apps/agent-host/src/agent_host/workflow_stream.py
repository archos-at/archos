from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING
from typing import Any

from agent.common.turn_admission import TurnSlots
from agent.common.turn_admission import bind_turn_slots
from agent.common.turn_admission import return_turn_slots
from agent.observability.langfuse_scores import RuntimeScore
from agent.observability.langfuse_scores import emit_scores

if TYPE_CHECKING:
    from nat.runtime.session import Session

logger = logging.getLogger(__name__)

_END = object()

PRODUCER_TEARDOWN_SECONDS = 10.0


async def stream_workflow(payload: Any, *, session: Session) -> AsyncIterator[Any]:
    items: asyncio.Queue[Any] = asyncio.Queue()
    slots = TurnSlots()
    producer = asyncio.create_task(_produce(items, payload, session=session, slots=slots))
    producer.add_done_callback(lambda _: items.put_nowait(_END))
    producer.add_done_callback(_read_outcome)
    try:
        while (item := await items.get()) is not _END:
            yield item
        await producer
    finally:
        try:
            await _stop(producer)
        finally:
            await _return_slots(slots)


async def _produce(items: asyncio.Queue[Any], payload: Any, *, session: Session, slots: TurnSlots) -> None:
    bind_turn_slots(slots)  # this task's own context: every admission the workflow takes is recorded in it
    async with session.run(payload) as runner:
        async for item in runner.result_stream():
            items.put_nowait(item)


async def _stop(producer: asyncio.Task[None]) -> None:
    producer.cancel()
    done, _ = await asyncio.wait({producer}, timeout=PRODUCER_TEARDOWN_SECONDS)
    if not done:
        logger.warning(
            "The workflow's teardown did not finish within %.0fs of the stop; the turn ends without waiting for it",
            PRODUCER_TEARDOWN_SECONDS,
        )


async def _return_slots(slots: TurnSlots) -> None:
    try:
        stranded = await return_turn_slots(slots)
    except Exception:  # noqa: BLE001 - the lease still bounds a slot this could not give back
        logger.warning("Could not give back the admission slots of a stopped workflow", exc_info=True)
        return
    if stranded:
        logger.warning("The turn ended while its workflow still held %d admission slot(s); given back", stranded)
        emit_scores([RuntimeScore("turn-slots-stranded", float(stranded))], writer="chat")


def _read_outcome(producer: asyncio.Task[None]) -> None:
    if not producer.cancelled() and producer.exception() is not None:
        logger.debug("Workflow producer ended with %r", producer.exception())
