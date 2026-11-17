"""What the server keeps of a finished chat turn: its answer row, and the frames its Herleitung is folded from.

The answer is a row of its own (``turn_row_metadata``, posted by
``chat_socket.persist_turn_result``). The Herleitung is not: it hangs on the
QUESTION, as ``provenance.thinkingSteps``, the rows the turn fold
(``apps/workspace/bff/turns/turn-fold.ts``) makes of the step frames. Until the
server kept them, the only writer was the browser that watched the turn, so a
turn asked through the agent door, woken by an event, or whose browser closed
mid-turn reloaded without one. The sequencer now keeps the step frames the
fold needs (:class:`TurnFrames`), and they are posted after the answer row, in
a task of their own that nothing waits on (``chat_socket.persist_turn_result``,
``internal_api.post_internal_turn_steps``); the BFF folds them with the
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

#: The rows the stored Herleitung's sanitizer reads at all (``MAX_THINKING_STEPS_READ`` in
#: ``message-provenance.ts``, which ``turn-steps.spec.ts`` holds this to); a row past it is never stored.
MAX_STEP_ROWS = 2400
#: The most step frames one turn hands over: three per row (:class:`_Row`). The route's
#: ``MAX_TURN_STEP_FRAMES`` is held to it by ``turn-steps.spec.ts``.
MAX_STEP_FRAMES = 7200


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


def row_id(frame: Mapping[str, Any]) -> str | None:
    """The Herleitung row a frame makes or changes, by the id the fold keeps it under; None for no row. Pure."""
    if not touches_steps(frame):
        return None
    kind = frame.get("type")
    if kind in ("STEP_STARTED", "STEP_FINISHED"):
        step = frame.get("step")
        return str(step.get("id")) if isinstance(step, Mapping) else None
    if kind == "CUSTOM":
        value = frame.get("value")
        return f"steer:{value.get('steer_id')}" if isinstance(value, Mapping) else None
    return f"subagent:{frame.get('subagent_run_id')}"


def _titled(frame: Mapping[str, Any]) -> bool:
    step = frame.get("step")
    return isinstance(step, Mapping) and step.get("kind") == "skill" and bool(step.get("title"))


def _ends_subagent(frame: Mapping[str, Any]) -> bool:
    return frame.get("type") in ("SUBAGENT_FINISHED", "SUBAGENT_ERROR")


class _Row:
    """The frames of one row the fold needs, and no others.

    The fold's row is its first frame's time and its newest frame's fields
    (``foldStep``, ``foldSteer``), with two exceptions it reads from earlier
    frames: a skill's authored title, carried from the newest frame that had
    one, and a subagent's first end, which no later frame overwrites
    (``foldSubagent``). So the first, the newest titled and the newest frame
    (for a subagent: up to its first end) fold to the row all of them fold to.
    """

    __slots__ = ("closed", "first", "last", "titled")

    def __init__(self, frame: dict[str, Any]) -> None:
        self.first = frame
        self.titled: dict[str, Any] | None = frame if _titled(frame) else None
        self.last: dict[str, Any] | None = None
        self.closed = _ends_subagent(frame)

    def take(self, frame: dict[str, Any]) -> None:
        if self.closed:
            return
        self.last = frame
        if _titled(frame):
            self.titled = frame
        self.closed = _ends_subagent(frame)

    def frames(self) -> list[dict[str, Any]]:
        kept = [self.first, self.titled, self.last]
        return [frame for index, frame in enumerate(kept) if frame is not None and frame not in kept[:index]]


class TurnFrames:
    """A turn's stamped frames: the last ``maxlen`` for ``attach``, and what its Herleitung is folded from.

    The replay window drops a long answer's first steps behind its text
    deltas, so the step frames are kept apart: at most three per row
    (:class:`_Row`), for the first :data:`MAX_STEP_ROWS` rows, the rows the
    stored Herleitung's sanitizer reads at all. Both bounds keep exactly what
    the browser's fold and sanitizer store.
    """

    def __init__(self, maxlen: int) -> None:
        self._recent: deque[dict[str, Any]] = deque(maxlen=maxlen)
        self._rows: dict[str, _Row] = {}

    def append(self, frame: dict[str, Any]) -> None:
        self._recent.append(frame)
        key = row_id(frame)
        if key is None:
            return
        row = self._rows.get(key)
        if row is not None:
            row.take(frame)
        elif len(self._rows) < MAX_STEP_ROWS:
            self._rows[key] = _Row(frame)

    @property
    def steps(self) -> list[dict[str, Any]]:
        """The step frames kept, in ``seq`` order; at most :data:`MAX_STEP_FRAMES`."""
        kept = [frame for row in self._rows.values() for frame in row.frames()]
        return sorted(kept, key=lambda frame: frame["seq"])

    def __iter__(self) -> Iterator[dict[str, Any]]:
        return iter(self._recent)
