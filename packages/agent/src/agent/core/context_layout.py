from __future__ import annotations

import os
from typing import Any

LAYOUT_ENV = "CHAT_CONTEXT_LAYOUT"
TURN_LAYOUT = "turn"
CONVERSATION_LAYOUT = "conversation"

TURN_VALUES = frozenset(
    {
        "current_datetime",
        "user_info",
        "drafting_enabled",
        "skills_block",
        "card_shapes_block",
        "focus_file_name",
        "focus_shelf_label",
        "focus_file_path",
        "focus_region_block",
        "trigger_block",
        "answer_excerpt_block",
        "already_read_block",
        "workspace_block",
        "reference_projects",
        "personal_memory",
    }
)

_QUIET_IN_NOTE: dict[str, Any] = {
    "deep_research_enabled": True,
    "confined": False,
    "available_documents": [],
    "in_flight_documents": None,
    "document_inventory": "",
    "project_context": None,
    "platform_lessons": None,
    "org_instructions": None,
    "jurisdiction_note": None,
    "parcel_note": None,
    "building_law": None,
}

CONVERSATION_VALUES = frozenset(_QUIET_IN_NOTE)

CONVERSATION_PROVENANCE = (
    "From the platform, not the person's words: what holds for this whole conversation (the project, "
    "the office, the files). What only this turn has comes in `<turn_context>` before the newest message."
)

_TURN_TAG = "turn_context"
_CONVERSATION_TAG = "conversation_context"


def context_layout(template: str) -> str:
    value = (os.environ.get(LAYOUT_ENV) or "").strip().lower()
    if value == TURN_LAYOUT or f"<{_TURN_TAG}>" not in template:
        return TURN_LAYOUT
    return CONVERSATION_LAYOUT


def split_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    conversation = {key: (None if key in TURN_VALUES else value) for key, value in values.items()}
    conversation["current_datetime"] = ""
    note = {key: (value if key in TURN_VALUES else _QUIET_IN_NOTE.get(key)) for key, value in values.items()}
    return conversation, note


def _inventories(values: dict[str, Any]) -> tuple[str, str]:
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


_MEMORY_PART_HEADERS = (
    "PROJECT_MEMORY v1",
    "PROPOSAL_DECISIONS v1",
    "REVIEW_DECISIONS v1",
    "FOLDER_DESCRIPTIONS v1",
    "<office_base_knowledge>",
)


def split_project_context(composed: str | None) -> tuple[str | None, str | None]:
    if not composed:
        return None, None
    starts = [index for header in _MEMORY_PART_HEADERS if (index := composed.find(header)) >= 0]
    cut = min(starts, default=len(composed))
    profile, memory = composed[:cut].strip(), composed[cut:].strip()
    return profile or None, memory or None


def layout_values(values: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    conversation, note = split_values(values)
    conversation["document_inventory"], note["document_inventory"] = _inventories(values)
    conversation["project_context"], note["project_context"] = split_project_context(values.get("project_context"))
    return conversation, note


def as_conversation_context(rendered: str) -> str | None:
    inner = rendered.replace(f"<{_TURN_TAG}>", "").replace(f"</{_TURN_TAG}>", "")
    if not inner.strip():
        return None
    return rendered.replace(f"<{_TURN_TAG}>", f"<{_CONVERSATION_TAG}>\n{CONVERSATION_PROVENANCE}", 1).replace(
        f"</{_TURN_TAG}>", f"</{_CONVERSATION_TAG}>", 1
    )
