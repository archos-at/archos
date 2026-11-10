"""Where a chat turn's context sits in the request: a stable head and a turn note (ADR-0177).

WHY
===
A provider caches the prefix of a request: the tool schemas, the system
prompt, then the messages. The turn layout sent one turn context right before
the newest question, holding the project, the office, the inventory and what
only this turn has (the date, the asker, the open file). Most of it is the same
on every turn of a project, yet it sat after the history and was sent new on
every turn, so two turns, or two conversations of one project, shared nothing
past the system prompt but the history the window happened to keep.

The conversation layout, the default, splits it in two:

* the **conversation context**, what the project and the office set
  (:data:`CONVERSATION_VALUES`), one message right after the system prompt,
  with a cache breakpoint at its end. The same bytes on every turn and in every
  conversation of the project until a file settles or a memory note changes;
* the **turn note**, what this turn varies (:data:`TURN_VALUES`), right before
  the question where the turn context was, request-only as before.

Nothing else changes: what is stored, the write-back, the history window.
Every value the template reads is in exactly one of the two sets, held by a test
that parses the template, so a new value cannot land in the head unseen and
rewrite it every turn.

Ported from the unmerged ``feat/chat-conversation-context-layout`` branch: its
stable head only. Its first variant, storing each turn's note with its question
and moving the window in steps, was measured there to save ~1.8k new tokens per
follow-up and carry ~43k more history every round re-reads, a loss by the
seventh turn; it is not here.
"""

from __future__ import annotations

import os
from typing import Any

# @environment_variable CHAT_CONTEXT_LAYOUT
# @category Agent
# @type str
# @default conversation
# @required false
# Where a chat turn's context sits in the request. `conversation` (the default):
# what the project and the office set once after the system prompt, the same on
# every turn, and only the turn's own note before the question, so the
# provider's prompt cache holds the project context across turns and
# conversations. `turn`: one turn-context message right before the newest
# question, the layout before ADR-0177; the rollback.
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

#: What the project and the office set, and what each is in the turn's note:
#: absent, or the switch's quiet setting. The inventory is split (:func:`_inventories`).
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
    # The site's law from the platform's records (ADR-0168): a fact of the project.
    "building_law": None,
}

#: The template values that hold for the conversation: they make the conversation context.
CONVERSATION_VALUES = frozenset(_QUIET_IN_NOTE)

_TURN_TAG = "turn_context"
_CONVERSATION_TAG = "conversation_context"


def context_layout(template: str) -> str:
    """The layout a turn renders ``template`` in: :data:`TURN_LAYOUT` when asked for by name.

    Also for a template without the ``<turn_context>`` tags (a test's, a
    benchmark's): with nothing to retag, the head would be a second copy of it.
    """
    value = (os.environ.get(LAYOUT_ENV) or "").strip().lower()
    if value == TURN_LAYOUT or f"<{_TURN_TAG}>" not in template:
        return TURN_LAYOUT
    return CONVERSATION_LAYOUT


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

    The head lists every settled file on every shelf in scope: the same bytes
    until a file settles. The note carries what a turn varies: the files still
    being read, and, for a question that lists one shelf, which shelf it asked
    about, so the model answers from that group and no other.
    """
    from agent.knowledge.inventory import get_listing_shelf
    from agent.knowledge.inventory import in_scope_shelves_from_context
    from agent.knowledge.inventory import render_inventory_block
    from agent.knowledge.inventory_notes import focus_paragraph
    from agent.knowledge.inventory_notes import in_flight_paragraph

    documents = values.get("available_documents") or []
    whole = render_inventory_block(documents, in_scope_shelves=in_scope_shelves_from_context() or None)
    parts = (focus_paragraph(get_listing_shelf()), in_flight_paragraph(values.get("in_flight_documents")))
    return whole, "\n\n".join(part for part in parts if part)


def layout_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The template values of the conversation context and of the turn's note, inventories included."""
    conversation, note = split_values(values)
    conversation["document_inventory"], note["document_inventory"] = _inventories(values)
    return conversation, note


def as_conversation_context(rendered: str) -> str | None:
    """A turn-context render of the conversation's values, tagged as the conversation context; None when empty."""
    inner = rendered.replace(f"<{_TURN_TAG}>", "").replace(f"</{_TURN_TAG}>", "")
    if not inner.strip():
        return None
    return rendered.replace(f"<{_TURN_TAG}>", f"<{_CONVERSATION_TAG}>", 1).replace(
        f"</{_TURN_TAG}>", f"</{_CONVERSATION_TAG}>", 1
    )
