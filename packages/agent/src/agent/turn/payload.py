from dataclasses import dataclass
from typing import Literal
from typing import NamedTuple

from agent.common import parse_data_sources
from agent.common.client_tools import set_turn_client_tools
from agent.common.focus_file import get_focused_file_name
from agent.common.focus_file import get_focused_shelf
from agent.common.focus_file import set_turn_intent
from agent.common.reasoning_settings import set_turn_reasoning_effort
from agent.common.wire_v2 import FocusRegion
from agent.common.wire_v2 import TurnTrigger
from agent.common.wire_v2 import UserMessage


@dataclass(frozen=True)
class SubjectVersion:
    document_id: str | None = None
    version_id: str | None = None
    state: str | None = None

    @property
    def is_open(self) -> bool:
        return bool(self.document_id) and bool(self.version_id) and self.state in _OPEN_VERSION_STATES


_OPEN_VERSION_STATES = frozenset({"draft", "in_review", "changes_requested"})


TurnSurface = Literal["chat", "review_canvas", "annotation_thread"]


def thread_reply_requested(message: UserMessage) -> bool:
    region = message.focus_region
    return bool(message.reply_in_thread) and region is not None and bool(region.annotation_id)


def turn_surface(focus_region: FocusRegion | None, *, reply_in_thread: bool) -> TurnSurface:
    if reply_in_thread:
        return "annotation_thread"
    return "review_canvas" if focus_region is not None else "chat"


class TurnInputs(NamedTuple):
    query_text: str
    data_sources: list[str] | None
    focus_file_name: str | None
    focus_shelf: str | None
    subject: SubjectVersion = SubjectVersion()
    focus_region: FocusRegion | None = None
    reply_in_thread: bool = False
    trigger: TurnTrigger | None = None
    author_name: str | None = None

    @property
    def surface(self) -> TurnSurface:
        return turn_surface(self.focus_region, reply_in_thread=self.reply_in_thread)


def extract_turn_inputs(request: UserMessage | str) -> TurnInputs:
    if isinstance(request, str):
        set_turn_intent()
        set_turn_reasoning_effort(None)
        set_turn_client_tools(None)
        return TurnInputs(request.strip(), None, None, None)
    if not isinstance(request, UserMessage):
        raise TypeError(f"A turn is asked with a v2 user_message or a plain question, not a {type(request).__name__}")
    set_turn_intent(
        file_name=request.focus_file_name,
        shelf=request.focus_shelf,
        source_preset=request.source_preset,
        document_id=request.focus_document_id,
    )
    set_turn_reasoning_effort(request.reasoning_effort)
    set_turn_client_tools(request.client_tools)
    subject = SubjectVersion(request.focus_document_id, request.focus_version_id, request.focus_version_state)
    return TurnInputs(
        request.text.strip(),
        parse_data_sources(request.data_sources),
        get_focused_file_name(),
        get_focused_shelf(),
        subject,
        request.focus_region,
        thread_reply_requested(request),
        request.trigger,
        (request.author_name or "").strip() or None,
    )
