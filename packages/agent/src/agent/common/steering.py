from __future__ import annotations

import contextvars
import time
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from pydantic import BaseModel
from pydantic import ConfigDict

from agent.common.tool_calls import tool_basename
from agent.common.wire_v2 import FocusRegion

MAX_STEERS_PER_TURN = 5

WRITE_TOOL_BASENAMES: frozenset[str] = frozenset(
    {
        "mark",
        "reply",
        "highlight",
        "point",
        "update",
        "delete",
        "file_draft",
        "propose_file_change",
    }
)

HELD_FOR_STEER = (
    "Not executed: The person has added something since you chose this call. "
    "Read the addition and decide again; make the call again only if it still fits afterwards."
)


def is_write_call(call: Any) -> bool:
    name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
    return bool(name) and tool_basename(str(name)) in WRITE_TOOL_BASENAMES


@dataclass(frozen=True)
class SteerNote:
    steer_id: str
    text: str
    author: str | None = None
    focus_region: FocusRegion | None = None
    received_at: float = field(default_factory=time.monotonic)


Offered = Literal["received", "duplicate", "limit"]


class SteerInbox:
    def __init__(self, *, limit: int = MAX_STEERS_PER_TURN) -> None:
        self.limit = limit
        self._pending: list[SteerNote] = []
        self._seen: set[str] = set()
        self.applied: list[SteerNote] = []

    def offer(self, note: SteerNote) -> Offered:
        if note.steer_id in self._seen:
            return "duplicate"
        if len(self._seen) >= self.limit:
            return "limit"
        self._seen.add(note.steer_id)
        self._pending.append(note)
        return "received"

    def has_pending(self) -> bool:
        return bool(self._pending)

    def take(self) -> list[SteerNote]:
        taken, self._pending = self._pending, []
        self.applied.extend(taken)
        return taken

    @property
    def received(self) -> int:
        return len(self._seen)


_INBOX: contextvars.ContextVar[SteerInbox | None] = contextvars.ContextVar("steer_inbox", default=None)


def bind_steer_inbox(inbox: SteerInbox | None) -> contextvars.Token[SteerInbox | None]:
    return _INBOX.set(inbox)


def unbind_steer_inbox(token: contextvars.Token[SteerInbox | None]) -> None:
    _INBOX.reset(token)


def current_steer_inbox() -> SteerInbox | None:
    return _INBOX.get()


class AppliedSteer(BaseModel):
    model_config = ConfigDict(frozen=True)

    steer_id: str
    content: str
    at: int
    round: int


def _region_line(region: FocusRegion) -> str:
    return (
        f"[Region: p. {region.page}, x {region.x:.2f}–{region.x + region.w:.2f}, "
        f"y {region.y:.2f}–{region.y + region.h:.2f}]"
    )


def render_note(note: SteerNote, round_index: int) -> str:
    author = f' author="{note.author}"' if note.author else ""
    lines = [f'<user_update{author} during="round {round_index}">', note.text.strip()]
    if note.focus_region is not None:
        lines.append(_region_line(note.focus_region))
    lines.append("</user_update>")
    lines.append(
        "The person wrote this while you were working. It applies from now on and takes precedence over the "
        "original question wherever the two contradict. What you have already proposed stays "
        "until someone dismisses it; mention it in your answer if it no longer holds."
    )
    return "\n".join(lines)


def with_steering(request: Sequence[BaseMessage], applied: Sequence[AppliedSteer], *, offset: int = 1) -> list[Any]:
    messages = list(request)
    if not applied:
        return messages
    notes_at: dict[int, list[HumanMessage]] = {}
    for steer in applied:
        position = min(len(messages), offset + steer.at)
        notes_at.setdefault(position, []).append(HumanMessage(content=steer.content))
    spliced: list[Any] = []
    for index, message in enumerate(messages):
        spliced.extend(notes_at.pop(index, ()))
        spliced.append(message)
    for position in sorted(notes_at):
        spliced.extend(notes_at[position])
    return spliced
