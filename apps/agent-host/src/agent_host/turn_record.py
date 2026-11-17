from __future__ import annotations

from collections import deque
from collections.abc import Iterator
from collections.abc import Mapping
from typing import Any

from agent.common.wire_v2 import RunFinishedBody
from agent.observability.turn_trace import TRACE_ID_METADATA_KEY
from agent.observability.turn_trace import trace_id_for_message
from agent.observability.turn_trace import trace_id_hex

_NOT_METADATA = {"message_id", "text", "cards", "job_admission_rejected", "retry_after_seconds", "run"}

STEP_FRAME_TYPES = frozenset(
    {"STEP_STARTED", "STEP_FINISHED", "SUBAGENT_STARTED", "SUBAGENT_FINISHED", "SUBAGENT_ERROR"}
)
STEP_CUSTOM_NAMES = frozenset({"steer_received", "steer_applied"})

MAX_STEP_ROWS = 2400
MAX_STEP_FRAMES = 7200


def turn_row_metadata(finished: RunFinishedBody) -> dict[str, Any] | None:
    result = finished.result
    if result.job_admission_rejected or not (result.text.strip() or result.cards):
        return None
    metadata = result.model_dump(mode="json", exclude_defaults=True, exclude=_NOT_METADATA)
    if result.cards:
        metadata["cards"] = [keyed.card for keyed in result.cards]
    if finished.outcome == "cancelled":
        metadata["stopped"] = True
    trace_id = trace_id_hex(trace_id_for_message(result.message_id))
    if trace_id:
        metadata[TRACE_ID_METADATA_KEY] = trace_id
    return metadata


def touches_steps(frame: Mapping[str, Any]) -> bool:
    kind = frame.get("type")
    return kind in STEP_FRAME_TYPES or (kind == "CUSTOM" and frame.get("name") in STEP_CUSTOM_NAMES)


def row_id(frame: Mapping[str, Any]) -> str | None:
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
        kept = [frame for row in self._rows.values() for frame in row.frames()]
        return sorted(kept, key=lambda frame: frame["seq"])

    def __iter__(self) -> Iterator[dict[str, Any]]:
        return iter(self._recent)
