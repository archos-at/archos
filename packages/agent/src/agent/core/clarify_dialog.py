from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING
from typing import Any

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolCall
from langchain_core.messages import ToolMessage
from pydantic import BaseModel
from pydantic import ValidationError

from agent.common import content_to_text
from agent.common import extract_json
from agent.common import get_latest_user_query
from agent.common import render_prompt_template

from .clarify_prompts import CLARIFICATION_PROMPT
from .clarify_prompts import JSON_REMINDER_AFTER_TOOLS
from .models.clarify import ClarificationResponse
from .models.clarify import ClarifyRequest

if TYPE_CHECKING:
    from .clarify import ClarifyDeps

logger = logging.getLogger(__name__)

SKIP_COMMANDS = frozenset({"skip", "done", "exit", "quit", "proceed", "continue", "no", "n", ""})
"""Replies to a clarification QUESTION that mean "stop asking and get on with it"."""

MAX_TOOL_ROUNDS = 4
"""How many times one clarification decision may search before it must decide.

The prompt asks for "at most 1-2 searches" and no transcript has ever needed a
third, so this is a ceiling and not a budget. It exists because the loop that
replaced the LangGraph has to state its own bound: the graph's was LangGraph's
``recursion_limit`` (25 super-steps for the whole dialog), which is not a
number anybody chose for this.
"""


def parse_json_response[ModelT: BaseModel](content: Any, schema: type[ModelT]) -> ModelT | None:
    payload = extract_json(content_to_text(content))
    if payload is None:
        logger.warning("No JSON in the %s reply: %.200s", schema.__name__, content_to_text(content))
        return None
    try:
        return schema.model_validate(payload)
    except ValidationError as exc:
        logger.warning("Reply did not validate as %s: %s", schema.__name__, exc)
        return None


def fallback_clarification(query: str | None) -> ClarificationResponse:
    if not query:
        return ClarificationResponse(
            needs_clarification=True,
            clarification_question=(
                "I'd like to help with your research. Could you provide more details about:\n\n"
                "1. What specific aspects interest you most?\n"
                "2. Who is this report for?\n"
                "3. How detailed should it be?"
            ),
            options=[],
        )
    topic_snippet = query[:80].strip() + ("..." if len(query) > 80 else "")
    return ClarificationResponse(
        needs_clarification=True,
        clarification_question=(
            f'To help with your research on: "{topic_snippet}"\n\n'
            "Could you specify:\n"
            "1. Which specific aspects are most important to you?\n"
            "2. What level of detail do you need?\n"
            "3. Or type 'skip' to proceed with a general approach."
        ),
        options=[],
    )


def question_for(response: ClarificationResponse | None, messages: Sequence[BaseMessage]) -> ClarificationResponse:
    if response is not None and response.is_valid():
        return response
    logger.warning("Unusable clarification from the model, asking the fallback question instead")
    return fallback_clarification(get_latest_user_query(list(messages)))


def _clarification_messages(
    request: ClarifyRequest, deps: ClarifyDeps, messages: Sequence[BaseMessage], log: str
) -> list[BaseMessage]:
    system_prompt = render_prompt_template(
        CLARIFICATION_PROMPT,
        clarifier_result=log,
        project_context=request.project_context,
        available_documents=request.available_documents or [],
        max_turns=deps.max_turns,
    )
    outgoing: list[BaseMessage] = [SystemMessage(content=system_prompt), *messages]
    if messages and isinstance(messages[-1], ToolMessage):
        outgoing.append(HumanMessage(content=JSON_REMINDER_AFTER_TOOLS))
    return outgoing


async def _run_one_tool(deps: ClarifyDeps, call: ToolCall) -> ToolMessage:
    call_id = call.get("id") or ""
    tool = deps.tools.get(call.get("name") or "")
    if tool is None:
        logger.warning("Clarifier: the model called an unknown tool %r", call.get("name"))
        return ToolMessage(content=f"Error: no tool named {call.get('name')!r}", tool_call_id=call_id)
    try:
        return await tool.ainvoke(call, config=deps.run_config)
    except Exception as exc:  # noqa: BLE001 - handed to the model as a tool result
        logger.exception("Clarifier: tool %s failed", tool.name)
        return ToolMessage(content=f"Error: {exc}", tool_call_id=call_id, status="error")


async def run_tool_calls(deps: ClarifyDeps, calls: Sequence[ToolCall]) -> list[ToolMessage]:
    return list(await asyncio.gather(*(_run_one_tool(deps, call) for call in calls)))


async def _decide(
    request: ClarifyRequest, deps: ClarifyDeps, messages: list[BaseMessage], log: str
) -> tuple[ClarificationResponse | None, list[BaseMessage]]:
    for _ in range(MAX_TOOL_ROUNDS + 1):
        reply = await deps.llm.ainvoke(_clarification_messages(request, deps, messages, log), config=deps.run_config)
        messages = [*messages, reply]
        if not getattr(reply, "tool_calls", None):
            return parse_json_response(reply.content, ClarificationResponse), messages
        messages = [*messages, *await run_tool_calls(deps, reply.tool_calls)]
    logger.warning("Clarifier: the model kept searching past %d rounds; proceeding without a question", MAX_TOOL_ROUNDS)
    return ClarificationResponse.complete(), messages


async def gather_clarification(request: ClarifyRequest, deps: ClarifyDeps) -> str:
    messages = list(request.messages)
    log = ""
    for turn in range(1, deps.max_turns + 1):
        response, messages = await _decide(request, deps, messages, log)
        if response is not None and not response.needs_clarification:
            return log
        clarification = question_for(response, messages)
        question = clarification.clarification_question or ""
        log = f"{log}\n**Turn {turn} - Assistant:**\n{question}"
        reply = await deps.ask_user(question, clarification.options)
        if reply.strip().lower() in SKIP_COMMANDS:
            logger.info("Clarifier: User requested to skip clarification")
            return f"{log}\n**Turn {turn} - User:** [Skipped clarification]"
        messages = [*messages, HumanMessage(content=reply)]
        log = f"{log}\n**Turn {turn} - User:**\n{reply}"
    return log
