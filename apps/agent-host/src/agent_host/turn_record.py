"""What the server keeps of a finished chat turn: its answer row, and the frames its Herleitung is folded from.

The answer is a row of its own (``turn_row_metadata``, posted by
``chat_socket.persist_turn_result``). The Herleitung is not: it hangs on the
QUESTION, as ``provenance.thinkingSteps``, the rows the turn fold
(``apps/workspace/bff/turns/turn-fold.ts``) makes of the step frames. Until the
server kept them, the only writer was the browser that watched the turn, so a
turn asked through the agent door, woken by an event, or whose browser closed
mid-turn reloaded without one. The sequencer now keeps every frame that touches
a step (:class:`TurnFrames`), and they are posted behind the answer row
(``internal_api.post_internal_turn_steps``); the BFF folds them with the
browser's own fold, so the two writers store the same rows and either may land
first.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterator
from collections.abc import Mapping
from typing import Any

from agent.common.wire_v2 import RunFinishedBody
from agent.observability.turn_trace import TRACE_ID_METADATA_KEY
from agent.observability.turn_trace import trace_id_for_message
from agent.observability.turn_trace import trace_id_hex

#: What the row does not keep: id and text are columns, cards unkeyed, a queue notice or run hand-off no answer.
_NOT_METADATA = {"message_id", "text", "cards", "job_admission_rejected", "retry_after_seconds", "run"}

#: The frames the fold makes Herleitung rows of (``turn-fold.ts``: ``foldStep``, ``foldSubagent``, ``foldSteer``).
STEP_FRAME_TYPES = frozenset(
    {"STEP_STARTED", "STEP_FINISHED", "SUBAGENT_STARTED", "SUBAGENT_FINISHED", "SUBAGENT_ERROR"}
)
STEP_CUSTOM_NAMES = frozenset({"steer_received", "steer_applied"})

#: The most step frames one turn hands over: twice the rows the stored Herleitung
#: keeps (``MAX_THINKING_STEPS`` in ``message-provenance.ts``), a start and an end each.
MAX_STEP_FRAMES = 1200


def turn_row_metadata(finished: RunFinishedBody) -> dict[str, Any] | None:
    """The message row's metadata for a finished turn, or None when nothing is written.

    Pure, from the typed result alone, in the wire spellings
    ``agent-answer-metadata.ts`` maps. A job-admission rejection is a transient
    notice, and a turn with no text and no cards (a run hand-off) has nothing
    to show.
    """
    result = finished.result
    if result.job_admission_rejected or not (result.text.strip() or result.cards):
        return None
    metadata = result.model_dump(mode="json", exclude_defaults=True, exclude=_NOT_METADATA)
    if result.cards:
        metadata["cards"] = [keyed.card for keyed in result.cards]
    if finished.outcome == "cancelled":
        metadata["stopped"] = True
    # The trace `_drive` pinned from the same id, so the BFF can score and link it (`observability.turn_trace`).
    trace_id = trace_id_hex(trace_id_for_message(result.message_id))
    if trace_id:
        metadata[TRACE_ID_METADATA_KEY] = trace_id
    return metadata


def touches_steps(frame: Mapping[str, Any]) -> bool:
    """Whether the fold makes (or changes) a Herleitung row of this frame. Pure."""
    kind = frame.get("type")
    return kind in STEP_FRAME_TYPES or (kind == "CUSTOM" and frame.get("name") in STEP_CUSTOM_NAMES)


class TurnFrames:
    """A turn's stamped frames: the last ``maxlen`` for ``attach``, and every one its Herleitung is folded from.

    The replay window drops a long answer's first steps behind its text deltas;
    the step frames are kept apart, so the stored Herleitung starts where the
    turn did. Bounded by :data:`MAX_STEP_FRAMES`: a turn past it keeps its first.
    """

    def __init__(self, maxlen: int) -> None:
        self._recent: deque[dict[str, Any]] = deque(maxlen=maxlen)
        self.steps: list[dict[str, Any]] = []

    def append(self, frame: dict[str, Any]) -> None:
        self._recent.append(frame)
        if len(self.steps) < MAX_STEP_FRAMES and touches_steps(frame):
            self.steps.append(frame)

    def __iter__(self) -> Iterator[dict[str, Any]]:
        return iter(self._recent)
