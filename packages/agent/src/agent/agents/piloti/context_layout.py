"""Where a chat turn's context sits in the request: one turn context, or a stable head and a turn note.

WHY
===
A provider caches the prefix of a request. Every call of a turn starts with
the tool schemas and the system prompt, then the turn layout
(``prompt.request_messages``) sends the history and, right before the newest
question, one turn context holding everything about the turn: the project, the
office, the inventory, and what only this turn has (the date, the asker, the
open file). Most of that context is the same on every turn of a project, yet it
sits after the history and is sent as new tokens on every turn, so two turns,
or two conversations of one project, share nothing past the system prompt but
the history the window happened to keep.

The conversation layout splits it in two:

* the **conversation context**, what the project and the office set
  (:data:`CONVERSATION_VALUES`), one message right after the system prompt. It
  is the same bytes on every turn and in every conversation of the project
  until a file settles or a memory note changes, so the provider's cache holds
  it across turns and across conversations;
* the **turn note**, what this turn varies (:data:`TURN_VALUES`), right before
  the question where the turn context was, and request-only as before.

Nothing else changes: the history window, the write-back, what is stored.
Every value the template reads is in exactly one of the two sets, held by a
test that parses the template, so a new value cannot land in the head unseen
and rewrite it every turn.

Behind :data:`LAYOUT_ENV`, default ``turn``: moving the project's facts before
the history changes what the model reads, so it switches on with the answer
suite's report (ADR-0154).
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

from agent.common.steering import AppliedSteer
from agent.common.steering import with_steering

# @environment_variable CHAT_CONTEXT_LAYOUT
# @category Agent
# @type str
# @default turn
# @required false
# Where a chat turn's context sits in the request. `turn`: one turn-context
# message right before the newest question. `conversation`: what the project
# and the office set once after the system prompt, the same on every turn, and
# only the turn's own note before the question, so the provider's prompt cache
# holds the project context across turns and conversations (the chat agent's
# `context_layout.py`, ADR-0154). Switch it on only with the answer suite's report.
LAYOUT_ENV = "CHAT_CONTEXT_LAYOUT"
TURN_LAYOUT = "turn"
CONVERSATION_LAYOUT = "conversation"

#: The template values a turn varies: they stay in the turn's note.
TURN_VALUES = frozenset(
    {
        "current_datetime",
        "user_info",
        # Bound per turn: the working directory may not be.
        "drafting_enabled",
        "skills_block",
        "card_shapes_block",
        "focus_file_name",
        "focus_shelf_label",
        "focus_file_path",
        "focus_region_block",
        "trigger_block",
        "already_read_block",
        "workspace_block",
        # Re-ordered for every question (``register._apply_reference_fit``).
        "reference_projects",
    }
)

#: What the project and the office set, and what each is in the turn's note: absent, or the
#: switch's quiet setting. The inventory is split between the two (:func:`_inventories`).
_QUIET_IN_NOTE: dict[str, Any] = {
    "deep_research_enabled": True,
    "confined": False,
    "available_documents": [],
    "in_flight_documents": None,
    "document_inventory": "",
    "project_context": None,
    "platform_lessons": None,
    "org_instructions": None,
    "oib_applicability": None,
    "parcel_note": None,
}

#: The template values that hold for the conversation: they make the conversation context.
CONVERSATION_VALUES = frozenset(_QUIET_IN_NOTE)

_TURN_TAG = "turn_context"
_CONVERSATION_TAG = "conversation_context"


def context_layout() -> str:
    """The layout this process renders: :data:`CONVERSATION_LAYOUT` only when asked for by name."""
    value = (os.environ.get(LAYOUT_ENV) or "").strip().lower()
    return CONVERSATION_LAYOUT if value == CONVERSATION_LAYOUT else TURN_LAYOUT


def split_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The template values of the conversation context and of the turn's note. Pure.

    Every value goes to exactly one part; in the other it is absent, or a switch
    in the setting that renders nothing (deep research on, not confined).
    """
    conversation = {key: (None if key in TURN_VALUES else value) for key, value in values.items()}
    conversation["current_datetime"] = ""
    note = {key: (value if key in TURN_VALUES else _QUIET_IN_NOTE.get(key)) for key, value in values.items()}
    return conversation, note


def _inventories(values: dict[str, Any]) -> tuple[str, str]:
    """The conversation's inventory, and the turn's part of it.

    The conversation context lists every settled file on every shelf in scope:
    the same bytes until a file settles. What a turn varies goes to its note:
    the files still being read (``knowledge.in_flight``), and, for a question
    that lists one shelf, that shelf alone (``get_listing_shelf``), so the model
    answers from it and cannot recite another shelf's files.
    """
    from agent.knowledge.in_flight import render_in_flight_note
    from agent.knowledge.inventory import get_listing_shelf
    from agent.knowledge.inventory import in_scope_shelves_from_context
    from agent.knowledge.inventory import render_inventory_block

    documents = values.get("available_documents") or []
    scoped = in_scope_shelves_from_context() or None
    whole = render_inventory_block(documents, in_scope_shelves=scoped)
    listed = get_listing_shelf()
    shelf = render_inventory_block(documents, in_scope_shelves=scoped, focus_shelf=listed) if listed else ""
    pending = render_in_flight_note(values.get("in_flight_documents"))
    return whole, "\n\n".join(part for part in (shelf, pending) if part)


def layout_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The template values of the conversation context and of the turn's note, inventories included."""
    conversation, note = split_values(values)
    conversation["document_inventory"], note["document_inventory"] = _inventories(values)
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


def conversation_request(
    system: str,
    conversation: str | None,
    note: str,
    history: Sequence[BaseMessage],
    steering: Sequence[AppliedSteer] = (),
) -> list[BaseMessage]:
    """One model call's request in the conversation layout. Pure.

    ``[system, conversation context, *earlier turns, turn note, newest
    question, *this turn]``: the turn layout's request with the conversation's
    part of the context moved to the head. Steering notes index past the newest
    question, behind everything in front of it.
    """
    newest = next(
        (index for index in range(len(history) - 1, -1, -1) if isinstance(history[index], HumanMessage)),
        0,
    )
    head: list[BaseMessage] = [SystemMessage(content=system)]
    if has_content(conversation):
        head.append(HumanMessage(content=conversation or ""))
    request = [*head, *history[:newest], HumanMessage(content=note), *history[newest:]]
    return with_steering(request, steering, offset=len(head) + 1)
