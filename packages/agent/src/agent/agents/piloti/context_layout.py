"""A conversation that only grows: where the turn context sits, and what the transcript keeps of it.

WHY
===
A provider caches the prefix of a request. Within a turn every round extends
the round before, so the rounds hit. Across turns the cache carries only as far
as the next turn's first request repeats the previous turn's last one, and the
turn-context layout (``prompt.request_messages``) repeats very little of it: the
context sat right before the previous question and is not stored, and the
history window moves every turn. Driven through this code, a three-turn
conversation's follow-up repeats 31 % of what the turn before sent (the agent's
``test_cross_turn_prefix.py``); in production a follow-up's
first call was as large and as uncached as an opening turn's (2026-11-04).

The conversation layout treats a conversation as one context that only grows:

* **What holds for the whole conversation comes first.** The blocks set by the
  project and the office (the inventory, the project context and memory, the
  office's instructions, its reference projects and lessons, the per-tenant
  switches) are one ``<conversation_context>`` message right after the system
  prompt, so every turn of the conversation, and every conversation of the same
  project, starts with the same bytes.
* **What a turn varies stays with that turn.** The rest (the date, the asker, the
  open file, what woke the turn, the workspace, what was already read, the
  skill and card shapes chosen for it, the answer language) is the turn's note,
  sent right before its question as before. It is now also STORED with the
  question (:data:`TURN_NOTE_KEY`), so the next turn sends the same note at the
  same place instead of dropping it.
* **The window moves only when the budget makes it, and then in steps.** Every
  turn keeps its (cited) tool results until the history no longer fits; then
  the oldest turns lose them :data:`STEP_TURNS` turns at a time
  (:func:`stepped_window`), so the transcript is rewritten once per step and
  only grows in between. The turn layout's window stays the fallback.

The answer is written back as before: the cited passages whole, the others
reduced to their headers (``history.compact_tool_results``).

Behind :data:`LAYOUT_ENV`, default ``turn``: what shapes an answer changes only
after the answer suite has measured it.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolMessage

from agent.common.steering import AppliedSteer
from agent.common.steering import with_steering

from .history import _count_message_tokens
from .history import _prose_only
from .history import compact_tool_results
from .history import history_window
from .history import replay_retired_look_names

# @environment_variable CHAT_CONTEXT_LAYOUT
# @category Agent
# @type str
# @default turn
# @required false
# Where a chat turn's context sits in the request. `turn`: one turn-context
# message right before the newest question, rebuilt every turn. `conversation`:
# the project and office blocks once after the system prompt, the turn's own
# note stored with its question, and a history window that moves in steps, so a
# follow-up repeats the previous turn's request and the provider's cache carries
# across turns (the chat agent's `context_layout.py`, ADR-0154). Switch it on
# only with the answer suite's report.
LAYOUT_ENV = "CHAT_CONTEXT_LAYOUT"
TURN_LAYOUT = "turn"
CONVERSATION_LAYOUT = "conversation"

#: Where a stored question keeps the note it was sent with.
TURN_NOTE_KEY = "turn_note"

#: How many turns lose their tool results at once when the history outgrows its budget.
STEP_TURNS = 3

#: The template values a turn varies: they stay in the turn's note.
TURN_VALUES = frozenset(
    {
        "current_datetime",
        "user_info",
        "skills_block",
        "card_shapes_block",
        "focus_file_name",
        "focus_shelf_label",
        "focus_file_path",
        "focus_region_block",
        "trigger_block",
        "already_read_block",
        "workspace_block",
    }
)

#: What each value is in the part it does not belong to: absent, or the switch's quiet setting.
_ABSENT_IN_NOTE: dict[str, Any] = {
    "deep_research_enabled": True,
    "confined": False,
    "drafting_enabled": False,
    "available_documents": [],
    "in_flight_documents": None,
    "document_inventory": "",
    "project_context": None,
    "platform_lessons": None,
    "org_instructions": None,
    "reference_projects": None,
    "oib_applicability": None,
    "parcel_note": None,
}

_TURN_TAG = "turn_context"
_CONVERSATION_TAG = "conversation_context"


def context_layout() -> str:
    """The layout this process renders: :data:`CONVERSATION_LAYOUT` only when asked for by name."""
    value = (os.environ.get(LAYOUT_ENV) or "").strip().lower()
    return CONVERSATION_LAYOUT if value == CONVERSATION_LAYOUT else TURN_LAYOUT


def split_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The template values for the conversation context and for the turn's note. Pure.

    Every value goes to exactly one part; in the other it is absent, or a switch
    in the setting that renders nothing (deep research on, not confined).
    """
    conversation = {key: (None if key in TURN_VALUES else value) for key, value in values.items()}
    conversation["current_datetime"] = ""
    note = {key: (value if key in TURN_VALUES else _ABSENT_IN_NOTE.get(key)) for key, value in values.items()}
    return conversation, note


def as_conversation_context(rendered: str) -> str:
    """A turn-context render of the conversation's values, tagged as the conversation context."""
    return rendered.replace(f"<{_TURN_TAG}>", f"<{_CONVERSATION_TAG}>", 1).replace(
        f"</{_TURN_TAG}>", f"</{_CONVERSATION_TAG}>", 1
    )


def has_content(rendered: str | None) -> bool:
    """Whether a rendered context holds anything between its tags."""
    if not rendered:
        return False
    inner = rendered
    for tag in (_TURN_TAG, _CONVERSATION_TAG):
        inner = inner.replace(f"<{tag}>", "").replace(f"</{tag}>", "")
    return bool(inner.strip())


def with_turn_notes(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """The transcript with each stored note put back in front of its question, as it was sent. Pure.

    The question goes out without the note in its metadata: the request is the
    same bytes the turn sent, whatever a provider adapter does with metadata.
    """
    shown: list[BaseMessage] = []
    for message in messages:
        note = message.additional_kwargs.get(TURN_NOTE_KEY) if isinstance(message, HumanMessage) else None
        if isinstance(note, str) and note:
            kwargs = {key: value for key, value in message.additional_kwargs.items() if key != TURN_NOTE_KEY}
            shown.append(HumanMessage(content=note))
            message = message.model_copy(update={"additional_kwargs": kwargs})
        shown.append(message)
    return shown


def conversation_request(
    system: str,
    conversation: str | None,
    note: str,
    history: Sequence[BaseMessage],
    steering: Sequence[AppliedSteer] = (),
) -> list[BaseMessage]:
    """One model call's request in the conversation layout. Pure.

    ``[system, conversation context, *earlier turns with their notes, this
    turn's note, newest question, *this turn]``. Steering notes index past the
    newest question, behind everything inserted in front of it.
    """
    newest = next(
        (index for index in range(len(history) - 1, -1, -1) if isinstance(history[index], HumanMessage)),
        0,
    )
    head: list[BaseMessage] = [SystemMessage(content=system)]
    if has_content(conversation):
        head.append(HumanMessage(content=conversation or ""))
    earlier = with_turn_notes(history[:newest])
    request = [*head, *earlier, HumanMessage(content=note), *history[newest:]]
    offset = len(head) + (len(earlier) - newest) + 1
    return with_steering(request, steering, offset=offset)


def _newest_question(messages: Sequence[BaseMessage]) -> HumanMessage | None:
    return next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)


def written_back(
    turn_messages: Sequence[BaseMessage],
    answer: BaseMessage,
    result_messages: Sequence[BaseMessage],
    note: str | None,
    cited: set[str],
) -> list[BaseMessage]:
    """What a finished turn writes to the transcript.

    Both layouts write the turn's tool calls with their results cut to the cited
    passages, then the answer. The conversation layout also writes the question
    again, with the note it was sent with in its metadata: the same id, so the
    transcript's reducer replaces it in place.
    """
    kept = [*compact_tool_results(list(turn_messages), cited), answer]
    if context_layout() != CONVERSATION_LAYOUT or not note:
        return kept
    question = _newest_question(result_messages)
    if question is None or not question.id:
        return kept
    noted = question.model_copy(update={"additional_kwargs": {**question.additional_kwargs, TURN_NOTE_KEY: note}})
    return [noted, *kept]


def _without_tool_results(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """Messages with their tool results gone: results drop, a call-only answer drops, an answer keeps its prose."""
    kept: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, ToolMessage):
            continue
        if isinstance(message, AIMessage) and getattr(message, "tool_calls", None):
            prose = _prose_only(message)
            if prose is not None:
                kept.append(prose)
            continue
        kept.append(message)
    return kept


def _pruned_before(messages: list[BaseMessage], starts: list[int], boundary: int) -> list[BaseMessage]:
    """The transcript with the turns before turn ``boundary`` reduced to what was said."""
    if boundary <= 0:
        return list(messages)
    cut = starts[boundary]
    return [*_without_tool_results(messages[:cut]), *messages[cut:]]


def stepped_window(messages: Sequence[BaseMessage], max_tokens: int, step: int = STEP_TURNS) -> list[BaseMessage]:
    """The history a model is handed in the conversation layout: a window that moves only when it must.

    Every turn keeps its (cited) tool results while the history fits the
    budget. When it does not, the oldest turns are reduced to what was said,
    ``step`` turns at a time and never the previous turn, so the boundary moves
    in jumps the budget forces and each turn in between sees the last one's
    history plus the turn in between. When even that does not fit, the turn
    layout's window decides, as before.
    """
    stored = replay_retired_look_names(list(messages))
    starts = [index for index, message in enumerate(stored) if isinstance(message, HumanMessage)]
    for boundary in range(0, max(len(starts) - 1, 1), step):
        window = _pruned_before(stored, starts, boundary)
        if _count_message_tokens(window) <= max_tokens:
            return window
    return history_window(stored, max_tokens)


def conversation_window(messages: Sequence[BaseMessage], max_tokens: int) -> list[BaseMessage]:
    """The history window of the layout this process renders."""
    if context_layout() == CONVERSATION_LAYOUT:
        return stepped_window(messages, max_tokens)
    return history_window(list(messages), max_tokens)
