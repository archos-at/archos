"""The two memory writers, run for real against a faked write endpoint.

Nothing of the product is copied here. The reflection pass is
``agent.memory.reflection.run_memory_reflection`` (its prompt, its schema, its
sanitiser, its writes); the tool pass binds the ``remember`` tool that
``agent.memory.register.project_memory_remember`` yields and runs its body on
whatever the model calls it with. Only ``bff_http.post_json`` is replaced: the
one function both writers' clients send through, so the client-side checks
(the secret and personal-data shapes) still run and a note is counted only
when it would have left the process.
"""

from __future__ import annotations

import contextlib
import re
from collections.abc import Iterator
from contextvars import ContextVar
from typing import Any

PROJECT_ID = "eval-project"
ORGANIZATION_ID = "eval-organization"
#: The name ``configs/config_oib_openrouter.yml`` binds the tool under (`functions.remember`).
TOOL_NAME = "remember"

#: The frame of the tool pass. The eval's own words, and deliberately thin: the
#: chat agent's system prompt names ``remember`` only for corrections, so what
#: steers the shelf in a turn is the tool's description and schema, which are
#: the production objects. This says where the conversation is and no more.
TOOL_PASS_SYSTEM = (
    "You are the assistant of an architecture office. You are talking with one member of the office "
    "inside one of its projects. Answer briefly, in the person's language. Call a tool only when its "
    "description says it applies."
)

_writes: ContextVar[list[dict[str, Any]] | None] = ContextVar("memory_shelves_writes", default=None)
_raw_reply: ContextVar[list[str] | None] = ContextVar("memory_shelves_raw_reply", default=None)


def _recording_post_json(path: str, payload: dict[str, Any], **_: Any) -> dict[str, Any]:
    """Stand in for the BFF: record which shelf the note reached, and answer as a created row."""
    writes = _writes.get()
    shelf = "personal" if path.endswith("/personal-memory") else str(payload.get("scope"))
    note = {"shelf": shelf, "kind": payload.get("kind"), "content": payload.get("content")}
    if writes is not None:
        writes.append(note)
    return {"item": {"id": f"eval-{len(writes or [])}"}, "created": True}


@contextlib.contextmanager
def faked_turn() -> Iterator[None]:
    """A signed-in person in a project, with every memory write recorded and none sent."""
    from agent import project_context
    from agent.common import bff_http
    from agent.memory import reflection

    real_reply = reflection.structured_reply

    async def recording_reply(llm: Any, messages: list[Any], schema: Any) -> str:
        text = await real_reply(llm, messages, schema)
        raw = _raw_reply.get()
        if raw is not None:
            raw.append(text)
        return text

    patches = [
        (bff_http, "post_json", _recording_post_json),
        (reflection, "structured_reply", recording_reply),
        (project_context, "get_request_envelope_from_context", lambda: ("eval", "eval")),
        (project_context, "get_project_id_from_context", lambda: PROJECT_ID),
        (project_context, "get_organization_id_from_context", lambda: ORGANIZATION_ID),
    ]
    saved = [(target, name, getattr(target, name)) for target, name, _ in patches]
    for target, name, value in patches:
        setattr(target, name, value)
    try:
        yield
    finally:
        for target, name, value in saved:
            setattr(target, name, value)


def _proposed_by_reflection(raw: str) -> list[dict[str, Any]]:
    """The findings as the model wrote them, before the production sanitiser."""
    from agent.common.json_utils import extract_json

    parsed = extract_json(raw)
    entries = parsed.get("findings") if isinstance(parsed, dict) else None
    shelves = {"person": "personal", "project": "project"}
    return [
        {
            "shelf": shelves.get(str(entry.get("about")).strip().lower(), "undecided"),
            "kind": entry.get("kind"),
            "content": str(entry.get("content") or ""),
        }
        for entry in entries or []
        if isinstance(entry, dict)
    ]


async def reflect_once(llm: Any, case: dict[str, Any]) -> dict[str, Any]:
    """One real reflection pass over the case's exchange."""
    from agent.common.bff_http import SignedEnvelope
    from agent.memory.reflection import run_memory_reflection

    writes: list[dict[str, Any]] = []
    raw: list[str] = []
    _writes.set(writes)
    _raw_reply.set(raw)
    await run_memory_reflection(
        llm=llm,
        query=case["user"],
        answer=case["assistant"],
        project_id=PROJECT_ID,
        organization_id=ORGANIZATION_ID,
        conversation_id=None,
        memory_digest=None,
        envelope=SignedEnvelope(header="eval", signature="eval"),
    )
    text = raw[0] if raw else ""
    return {"proposed": _proposed_by_reflection(text), "written": writes, "raw": text}


@contextlib.asynccontextmanager
async def remember_tool():
    """The production ``remember`` tool as a LangChain tool: its description, its schema, its body."""
    from langchain_core.tools import StructuredTool

    from agent.memory.register import ProjectMemoryRememberConfig
    from agent.memory.register import project_memory_remember

    # No judge model: the eval's turn has no restricted folder in scope, so the judge is never asked.
    async with project_memory_remember(ProjectMemoryRememberConfig(), None) as info:

        async def call(**arguments: Any) -> str:
            return await info.single_fn(info.input_schema(**arguments))

        yield StructuredTool(
            name=TOOL_NAME, description=info.description, args_schema=info.input_schema, coroutine=call
        )


async def _run_call(tool: Any, arguments: dict[str, Any]) -> str:
    """The tool's own answer to one call; a schema refusal reads as the tool loop would hand it back."""
    from pydantic import ValidationError

    try:
        return str(await tool.coroutine(**arguments))
    except ValidationError as exc:
        return f"Validation error: {re.sub(r'\s+', ' ', str(exc))[:300]}"


async def remember_once(llm: Any, tool: Any, case: dict[str, Any]) -> dict[str, Any]:
    """One turn's first model step with the tool bound: does it call ``remember``, and with which scope."""
    from langchain_core.messages import HumanMessage
    from langchain_core.messages import SystemMessage

    writes: list[dict[str, Any]] = []
    _writes.set(writes)
    reply = await llm.bind_tools([tool]).ainvoke(
        [SystemMessage(content=TOOL_PASS_SYSTEM), HumanMessage(content=case["user"])]
    )
    proposed = []
    for tool_call in getattr(reply, "tool_calls", None) or []:
        if tool_call.get("name") != TOOL_NAME:
            continue
        arguments = dict(tool_call.get("args") or {})
        proposed.append(
            {
                # The schema's default is what an omitted scope means.
                "shelf": str(arguments.get("scope") or "project").strip().lower(),
                "kind": arguments.get("kind"),
                "content": str(arguments.get("content") or ""),
                "result": await _run_call(tool, arguments),
            }
        )
    from agent.common.message_utils import content_to_text

    return {"proposed": proposed, "written": writes, "raw": content_to_text(reply.content)[:600]}
