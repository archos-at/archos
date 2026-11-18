from __future__ import annotations

import asyncio
import functools
import logging
import os
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Any
from typing import NamedTuple

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage

from agent.common import load_prompt
from agent.common import render_prompt_template
from agent.common.estate_paths import estate_path
from agent.common.estate_paths import reads_the_estate
from agent.common.law_gate import jurisdiction_note
from agent.common.law_gate import turn_building_law_block
from agent.common.norm_registry import parcel_note
from agent.common.page_region_words import percent
from agent.common.page_region_words import where_on_the_page_en
from agent.common.platform_lessons import render_lessons_block
from agent.common.prompt_caching import cached_context_message
from agent.common.prompt_caching import cached_system_message
from agent.common.prompt_store import ResolvedPrompt
from agent.common.prompt_store import git_blob_version
from agent.common.prompt_store import prompt_store
from agent.common.prompt_utils import PromptError
from agent.common.question_language import answer_language_line
from agent.common.question_language import question_language
from agent.common.question_language import trace_metadata as question_language_metadata
from agent.common.question_language import warm as warm_language_detector
from agent.common.source_kinds import SHELF_QUALIFIERS
from agent.common.source_kinds import parse_shelf
from agent.common.steering import AppliedSteer
from agent.common.steering import with_steering
from agent.knowledge.already_read import render_already_read_block
from agent.knowledge.project_memory import turn_personal_memory
from agent.observability.langfuse_trace_attributes import current_fallback_identity
from agent.observability.langfuse_trace_attributes import record_prompt_link
from agent.observability.langfuse_trace_attributes import record_trace_metadata

from .context_layout import TURN_LAYOUT
from .context_layout import as_conversation_context
from .context_layout import context_layout
from .context_layout import layout_values
from .models import ResearchAgentState

logger = logging.getLogger(__name__)

AGENT_DIR = Path(__file__).parent
PROMPTS_DIR = AGENT_DIR / "prompts"
PROMPT_NAME = "system"
WORKSPACE_TOOL_PREFIX = "workspace__"
STATIC_PROMPT_FILE = "chat_static.md"
STATIC_PROMPT_NAME = "piloti-system-static"


@functools.cache
def system_prompt_template() -> str:
    resolve_static_block()
    warm_language_detector()
    return load_prompt(PROMPTS_DIR, PROMPT_NAME)


@functools.cache
def bundled_static_block() -> ResolvedPrompt:
    path = PROMPTS_DIR / STATIC_PROMPT_FILE
    return ResolvedPrompt(
        text=load_prompt(PROMPTS_DIR, STATIC_PROMPT_FILE),
        name=f"git:{path.relative_to(AGENT_DIR)}",
        version=git_blob_version(path),
        is_fallback=True,
    )


RETIRED_STATIC_BLOCK = "<building_law>"


def resolve_static_block() -> ResolvedPrompt:
    resolved = prompt_store().get(STATIC_PROMPT_NAME, fallback=bundled_static_block())
    if not resolved.is_fallback and RETIRED_STATIC_BLOCK in resolved.text:
        resolved = bundled_static_block()
    if not resolved.is_fallback and not _renders(resolved.text):
        resolved = bundled_static_block()
    record_prompt_link(name=resolved.name, version=resolved.version, is_fallback=resolved.is_fallback)
    return resolved


async def stamp_static_prompt_for_turn(messages: Sequence[BaseMessage] = ()) -> str:
    static_text = await asyncio.to_thread(_render_resolved_static_block)
    record_static_prompt_metadata()
    record_trace_metadata(**question_language_metadata(question_language(messages)))
    return static_text


def _render_resolved_static_block() -> str:
    return render_static_block(resolve_static_block().text)


def record_static_prompt_metadata() -> None:
    fallback = current_fallback_identity()
    if fallback is None:
        return
    name, version = fallback
    record_trace_metadata(prompt_name=name, prompt_version=version)


@functools.lru_cache(maxsize=4)
def _renders(static_text: str) -> bool:
    try:
        render_static_block(static_text)
    except PromptError:
        logger.warning(
            "The static prompt served by the store does not render as a template; "
            "the bundled file serves until the published version is fixed",
            exc_info=True,
        )
        return False
    return True


@functools.lru_cache(maxsize=4)
def render_static_block(static_text: str) -> str:
    return render_prompt_template(static_text, document_inventory="").rstrip("\n")


def shelf_label(shelf: str | None) -> str | None:
    if not shelf:
        return None
    parsed = parse_shelf(shelf)
    return SHELF_QUALIFIERS.get(parsed) if parsed is not None else None


def focus_file_path(state: Any, tool_names: Sequence[str]) -> str | None:
    file_name = getattr(state, "focus_file_name", None)
    shelf = getattr(state, "focus_shelf", None)
    if not file_name or not shelf or not reads_the_estate(tool_names):
        return None
    parsed = parse_shelf(shelf)
    return estate_path(parsed if parsed is not None else shelf, None, file_name)


def focus_region_block(state: Any, tool_names: Sequence[str]) -> str | None:
    region = getattr(state, "focus_region", None)
    if region is None:
        return None
    file_name = getattr(state, "focus_file_name", None)
    document = f"of **{file_name}**" if file_name else "of the open document"
    box = f"[{region.x:.3f}, {region.y:.3f}, {region.w:.3f}, {region.h:.3f}]"
    canvas = "canvas__highlight" in tool_names
    target = f'`document="{file_name}"`, ' if file_name else ""
    lines = [
        "## Focus region",
        f"The person drew a frame on page {region.page} {document}: {where_on_the_page_en(region)}, "
        f"about {percent(region.w)} of the page width and {percent(region.h)} of the page height (`region={box}`: "
        "x, y, w, h as shares of the page, origin top left). „Hier“, „das“ and „diese Stelle“ mean this "
        "crop.",
        f"Look at it before you answer: `look` with {target}`page={region.page}` and `region={box}`. "
        "Answer about what lies within the frame, and say so if you need something outside it for that. "
        "If an earlier state is asked about, look at the same crop in that Fassung.",
    ]
    if canvas:
        lines.append(
            "Show with `canvas__highlight` or `canvas__point` what you refer to; you propose findings with "
            "`canvas__mark` as Anmerkungen, the spot read off what you saw. What the person "
            "explicitly asks for, you do in their name: `canvas__mark` with `open=true`, `canvas__update`, "
            "`canvas__delete`."
        )
    if getattr(state, "reply_in_thread", False) and region.annotation_id and canvas:
        lines.append(
            f"You were asked in the thread of the Anmerkung with id `{region.annotation_id}`: answer there with "
            "`canvas__reply` (`annotation` = this id), briefly, understandable on its own "
            "and without source marks, and "
            "give the same answer here."
        )
    lines.append(
        "If the tool shows no image, for instance because this office's model does not read images, say so openly and "
        "do not guess what is inside the frame."
    )
    return "\n".join(lines)


_TRIGGER_EVENTS = {
    "thread_mention": "mentioned you in the thread of an Anmerkung",
    "thread_reply": "replied in the thread of an Anmerkung you started",
    "assigned": "assigned an Anmerkung to you",
    "agent_consult": "asked you through a connected agent (such as Claude or Cursor)",
    "new_document": "uploaded a new document that has just been indexed, and this check was queued for it",
}


def trigger_block(state: Any, tool_names: Sequence[str]) -> str | None:
    trigger = getattr(state, "trigger", None)
    if trigger is None:
        return None
    user = getattr(state, "user_info", None) or {}
    who = (user.get("name") or user.get("email") or "A person") if isinstance(user, dict) else "A person"
    lines = [
        "## Woken by",
        f"Nobody typed this question into the chat: {who} {_TRIGGER_EVENTS[trigger.kind]} "
        f"(event `{trigger.event_id}`), and that woke you. Nobody watches this turn live.",
    ]
    if trigger.annotation_id and "canvas__reply" in tool_names:
        lines.append(
            f"Answer where it happened: in the thread of the Anmerkung `{trigger.annotation_id}`, with "
            "`canvas__reply` (`annotation` = this id), short and readable on its own. If you need something, "
            "ask in that thread; do not wait for an answer in this turn."
        )
    else:
        lines.append(
            "Answer so the person finds it where they asked. If you need something, ask in your answer; do not "
            "wait for an answer in this turn."
        )
    return "\n".join(lines)


def build_tools_info(tools: Sequence[Any]) -> list[dict[str, str]]:
    return [
        {
            "name": getattr(tool, "name", str(tool)),
            "description": getattr(tool, "description", "No description available"),
        }
        for tool in tools
    ]


class TurnPrompt(NamedTuple):
    system: str
    context: str
    conversation: str | None = None


def cached_turn_prompt(state: ResearchAgentState) -> TurnPrompt | None:
    if state.cached_system_prompt is None or state.cached_turn_context is None:
        return None
    return TurnPrompt(state.cached_system_prompt, state.cached_turn_context, state.cached_conversation_context)


def cached_prompt_fields(prompt: TurnPrompt) -> dict[str, str | None]:
    return {
        "cached_system_prompt": prompt.system,
        "cached_turn_context": prompt.context,
        "cached_conversation_context": prompt.conversation,
    }


def render_turn_prompt(template: str, state: ResearchAgentState, tools_info: Sequence[dict[str, str]]) -> TurnPrompt:
    static = resolve_static_block().text
    values = turn_context_values(state, tools_info)
    if context_layout(template) == TURN_LAYOUT:
        return TurnPrompt(
            system=render_static_block(static),
            context=with_answer_language(_render_context(template, values), state.messages),
        )
    conversation, note = layout_values(values)
    return TurnPrompt(
        system=render_static_block(static),
        context=with_answer_language(_render_context(template, note), state.messages),
        conversation=as_conversation_context(_render_context(template, conversation)),
    )


def with_answer_language(context: str, messages: Sequence[BaseMessage]) -> str:
    line = answer_language_line(question_language(messages))
    return context if line is None else f"{context.rstrip()}\n\n{line}"


def request_messages(
    prompt: TurnPrompt,
    history: Sequence[BaseMessage],
    steering: Sequence[AppliedSteer] = (),
) -> list[BaseMessage]:
    newest = next(
        (index for index in range(len(history) - 1, -1, -1) if isinstance(history[index], HumanMessage)),
        0,
    )
    head = [cached_system_message(prompt.system)]
    if prompt.conversation:
        head.append(cached_context_message(prompt.conversation))
    request = [*head, *history[:newest], HumanMessage(content=prompt.context), *history[newest:]]
    return with_steering(request, steering, offset=len(head) + 1)


def _site_blocks(state: ResearchAgentState, documents: list[dict[str, Any]], tool_names: list[str]) -> dict[str, Any]:
    return {
        "focus_file_name": state.focus_file_name,
        "focus_shelf_label": shelf_label(state.focus_shelf),
        "focus_file_path": focus_file_path(state, tool_names),
        "focus_region_block": focus_region_block(state, tool_names),
        "trigger_block": trigger_block(state, tool_names),
        "building_law": turn_building_law_block(),
        "jurisdiction_note": jurisdiction_note(),
        "parcel_note": parcel_note(documents),
    }


def render_turn_context(
    template: str,
    state: ResearchAgentState,
    tools_info: Sequence[dict[str, str]],
) -> str:
    return _render_context(template, turn_context_values(state, tools_info))


def _render_context(template: str, values: dict[str, Any]) -> str:
    rendered = render_prompt_template(template, **values)
    if os.environ.get("DEBUG_PROMPTS"):
        logger.debug("Rendered turn context:\n%s", rendered)
    return rendered


def turn_context_values(
    state: ResearchAgentState,
    tools_info: Sequence[dict[str, str]],
) -> dict[str, Any]:
    documents = [doc.model_dump() for doc in (state.available_documents or [])]
    tool_names = [str(tool.get("name", "")) for tool in tools_info]
    return dict(
        deep_research_enabled=state.deep_research_allowed,
        confined=state.confined,
        drafting_enabled="write_file" in tool_names,
        user_info=state.user_info,
        current_datetime=datetime.now().strftime("%Y-%m-%d"),
        available_documents=documents,
        already_read_block=render_already_read_block(state.already_read_digest),
        in_flight_documents=state.in_flight_documents,
        project_context=state.project_context,
        platform_lessons=render_lessons_block(state.platform_lessons),
        org_instructions=state.org_instructions,
        reference_projects=state.reference_projects if "project_lookup" in tool_names else None,
        workspace_block=(
            state.workspace_block if any(name.startswith(WORKSPACE_TOOL_PREFIX) for name in tool_names) else None
        ),
        personal_memory=turn_personal_memory(),
        **_site_blocks(state, documents, tool_names),
        skills_block=state.skills_block,
        card_shapes_block=state.card_shapes_block,
    )
