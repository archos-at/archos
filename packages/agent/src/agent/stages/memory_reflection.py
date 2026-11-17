from __future__ import annotations

import logging
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import Field

from agent.common.canned_replies import NON_ANSWER_PREFIXES
from agent.common.model_overrides import AgentGroup
from agent.knowledge.project_memory import begin_turn_memory_log
from agent.knowledge.project_memory import end_turn_memory_log
from agent.knowledge.project_memory import turn_memory_notes
from agent.knowledge.project_memory import turn_refreshed_memory_ids
from agent.stages.durable_frame import schedule_durable_frame
from agent.stages.registry import register_stage
from agent.stages.spec import GateDecision
from agent.stages.spec import StageContext
from agent.stages.spec import StageEmpty
from agent.stages.spec import StageSpec
from agent.stages.spec import TurnFacts

logger = logging.getLogger(__name__)

REFLECTION_NON_ANSWERS = NON_ANSWER_PREFIXES

_INSUFFICIENCY_PHRASES = (
    "i don't have enough information",
    "unable to find",
    "need more research",
    "keine ausreichenden informationen",
    "nicht genügend informationen",
    "konnte keine informationen",
    "keine informationen gefunden",
    "nicht finden",
    "weitere recherche erforderlich",
    "genauere prüfung erforderlich",
)

_INSUFFICIENCY_TAIL_CHARS = 800


def matches_escalation_keywords(content: str) -> bool:
    tail = content[-_INSUFFICIENCY_TAIL_CHARS:].lower()
    return any(phrase in tail for phrase in _INSUFFICIENCY_PHRASES)


_SKIP_ROUTES = {"meta", "error"}

REFLECTION_TIMEOUT_S = 45.0

MEMORY_REFLECTION_STAGE_ID = "memory_reflection"

MAX_NOTED_ITEMS = 6


class MemoryReflectionItem(BaseModel):
    id: str = Field(description="Id of the project_memory row.")
    kind: str = Field(description="decision | constraint | open_question | derived_fact | preference.")
    content: str = Field(description="The finding, verbatim as it was written.")
    provenance: Literal["agent"] | None = Field(
        default=None, description="'agent': the remember tool wrote it during the answer. Absent: this stage did."
    )
    scope: Literal["organization"] | None = Field(
        default=None, description="'organization': everyone in the office reads it. Absent: the project's members."
    )
    supersedes: str | None = Field(
        default=None, description="The earlier note this one retired, quoted. Absent when it retired none."
    )
    restricted: Literal[True] | None = Field(
        default=None, description="True: restricted memory, shown only to people cleared for its folders."
    )


class MemoryReflectionPayload(BaseModel):
    items: list[MemoryReflectionItem] = Field(description="The project_memory rows written, in write order.")


def _gate(facts: TurnFacts) -> GateDecision:
    decision = _reflection_gate(facts)
    if not decision.run and facts.noted_this_turn:
        return GateDecision.proceed()
    return decision


def _reflection_gate(facts: TurnFacts) -> GateDecision:
    if facts.temporary:
        return GateDecision.skip("temporary_conversation")
    if facts.run_id:
        return GateDecision.skip("commissioned_run")
    if not facts.project_id:
        return GateDecision.skip("no_project")
    text = (facts.answer or "").strip()
    if not facts.query or not text:
        return GateDecision.skip("empty_turn")
    if facts.research_truncated:
        return GateDecision.skip("research_truncated")
    if any(text.startswith(prefix) for prefix in REFLECTION_NON_ANSWERS):
        return GateDecision.skip("canned_non_answer")
    if matches_escalation_keywords(text):
        return GateDecision.skip("escalation")
    if facts.routing_decision in _SKIP_ROUTES:
        return GateDecision.skip(f"routing_{facts.routing_decision}")
    return GateDecision.proceed()


def digest_with_turn_writes(memory_digest: str | None, written: tuple[str, ...]) -> str | None:
    if not written:
        return memory_digest
    lines = [f'- [this turn | recorded] "{content.replace(chr(34), chr(39))}"' for content in written]
    return "\n".join(([memory_digest.rstrip()] if memory_digest else []) + lines)


async def _reflected_items(ctx: StageContext) -> tuple[list[dict[str, Any]], str | None]:
    from agent.memory.reflection import run_memory_reflection
    from agent.turn.response import answer_message_id

    facts = ctx.facts
    answer_id = answer_message_id(facts.conversation_id, facts.ws_parent_id) if facts.ws_parent_id else None
    token = begin_turn_memory_log(answer_message_id=answer_id)
    try:
        recorded = await run_memory_reflection(
            llm=ctx.llm,
            query=facts.query,
            answer=facts.answer,
            project_id=facts.project_id,
            organization_id=facts.organization_id,
            conversation_id=facts.conversation_id,
            memory_digest=digest_with_turn_writes(facts.memory_digest, facts.remembered_this_turn),
            restriction=facts.restriction,
            personal_memory=facts.personal_memory,
            envelope=facts.envelope,
        )
        created = {note.id: note for note in turn_memory_notes()}
        refreshed = turn_refreshed_memory_ids()
    finally:
        end_turn_memory_log(token)
    items: list[dict[str, Any]] = []
    for item in recorded or []:
        if item.get("about") == "person" or item["id"] in refreshed:
            continue
        note = created.get(item["id"])
        items.append(note.frame_item(in_turn=False) if note else {key: item[key] for key in ("id", "kind", "content")})
    if items or not recorded:
        return items, None
    personal = any(item.get("about") == "person" for item in recorded)
    return items, "personal_notes_only" if personal else "restated_notes_only"


async def _handler(ctx: StageContext) -> dict[str, Any] | StageEmpty | None:
    facts = ctx.facts
    noted = [note.frame_item(in_turn=True) for note in facts.noted_this_turn[:MAX_NOTED_ITEMS]]
    reflected: list[dict[str, Any]] = []
    empty_reason: str | None = None
    if _reflection_gate(facts).run and not facts.drew_on_other_projects:
        reflected, empty_reason = await _reflected_items(ctx)
    items = [*noted, *reflected]
    if items:
        payload = {"items": items}
        schedule_durable_frame(facts, MEMORY_REFLECTION_STAGE_ID, payload)
        return payload
    return StageEmpty(empty_reason) if empty_reason else None


MEMORY_REFLECTION = register_stage(
    StageSpec(
        id=MEMORY_REFLECTION_STAGE_ID,
        agent_group=AgentGroup.MEMORY_REFLECTION,
        flag_slug="memory-reflection",
        timeout_s=REFLECTION_TIMEOUT_S,
        gate=_gate,
        handler=_handler,
        payload_model=MemoryReflectionPayload,
        delivery="frame",
        max_output_tokens=None,
    )
)
