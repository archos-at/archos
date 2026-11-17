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
  conversation of the project until a file settles or the profile changes;
* the **turn note**, what this turn varies (:data:`TURN_VALUES`), right before
  the question where the turn context was, request-only as before. The project
  context's memory part goes here too (:func:`split_project_context`): the BFF
  picks and orders the memory notes by their relevance to the question.

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
        # The asker's own notes (ADR-0180): a shared conversation has more than
        # one asker, and the head is the same bytes for all of them.
        "personal_memory",
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
    # The knowledge context's gate note: the project's country and coverage (ADR-0173).
    "jurisdiction_note": None,
    "parcel_note": None,
    # The site's law from the platform's records (ADR-0168): a fact of the project.
    "building_law": None,
}

#: The template values that hold for the conversation: they make the conversation context.
CONVERSATION_VALUES = frozenset(_QUIET_IN_NOTE)

#: Where the head comes from. The static prompt describes the `<turn_context>`
#: before the newest message as the platform's; this message, after the system
#: prompt, holds the project's profile, the office's instructions and the file
#: names, and says the same of itself rather than leave the model to guess
#: whether a person wrote it. Said here, not in ``chat_static.md``, whose bytes
#: key every cache shard and are published to Langfuse by hand.
CONVERSATION_PROVENANCE = (
    "From the platform, not the person's words: what holds for this whole conversation (the project, "
    "the office, the files). What only this turn has comes in `<turn_context>` before the newest message."
)

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
    being read. A question that lists ONE shelf gets that shelf's inventory in
    its note and none in the head: with every shelf in view, the model read
    OIB filenames out as the Büroablage (``render_inventory_block``'s
    ``focus_shelf``), so on that turn the head gives up its cache.
    """
    from agent.knowledge.inventory import get_listing_shelf
    from agent.knowledge.inventory import in_scope_shelves_from_context
    from agent.knowledge.inventory import render_inventory_block
    from agent.knowledge.inventory_notes import in_flight_paragraph

    documents = values.get("available_documents") or []
    in_flight = values.get("in_flight_documents")
    scope = in_scope_shelves_from_context() or None
    focus = get_listing_shelf()
    if focus is not None:
        return "", render_inventory_block(documents, in_scope_shelves=scope, focus_shelf=focus, in_flight=in_flight)
    return render_inventory_block(documents, in_scope_shelves=scope), in_flight_paragraph(in_flight) or ""


#: The headers that open the parts of the project context after the profile
#: (``compose_project_context`` + ``turn/context_client.with_base_knowledge``;
#: the BFF's ``composeMemoryContext``). The memory digest among them is picked
#: and ordered per question, by its recall score.
_MEMORY_PART_HEADERS = (
    "PROJECT_MEMORY v1",
    "PROPOSAL_DECISIONS v1",
    "REVIEW_DECISIONS v1",
    "FOLDER_DESCRIPTIONS v1",
    "<office_base_knowledge>",
)


def split_project_context(composed: str | None) -> tuple[str | None, str | None]:
    """The project context as (profile, memory part). Pure.

    The profile is the same for every question of the project; the memory part
    is not (``buildProjectMemoryDigest`` ranks unpinned notes by the question),
    so only the profile may sit in the stable head.
    """
    if not composed:
        return None, None
    starts = [index for header in _MEMORY_PART_HEADERS if (index := composed.find(header)) >= 0]
    cut = min(starts, default=len(composed))
    profile, memory = composed[:cut].strip(), composed[cut:].strip()
    return profile or None, memory or None


def layout_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The template values of the conversation context and of the turn's note, inventories included."""
    conversation, note = split_values(values)
    conversation["document_inventory"], note["document_inventory"] = _inventories(values)
    conversation["project_context"], note["project_context"] = split_project_context(values.get("project_context"))
    return conversation, note


def as_conversation_context(rendered: str) -> str | None:
    """A turn-context render of the conversation's values, tagged as the conversation context; None when empty."""
    inner = rendered.replace(f"<{_TURN_TAG}>", "").replace(f"</{_TURN_TAG}>", "")
    if not inner.strip():
        return None
    return rendered.replace(f"<{_TURN_TAG}>", f"<{_CONVERSATION_TAG}>\n{CONVERSATION_PROVENANCE}", 1).replace(
        f"</{_TURN_TAG}>", f"</{_CONVERSATION_TAG}>", 1
    )
