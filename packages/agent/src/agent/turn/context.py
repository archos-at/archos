from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Any

from agent.auth import get_current_principal
from agent.common.bff_http import SignedEnvelope
from agent.common.knowledge_context import UNAVAILABLE
from agent.common.knowledge_context import KnowledgeContext
from agent.common.platform_lessons import LessonsResolution
from agent.common.platform_lessons import resolve_platform_lessons
from agent.knowledge.project_memory import fetch_memory_digest
from agent.knowledge.restricted_collections import restricted_collections_in
from agent.knowledge.restricted_use import current_cross_project_turn
from agent.knowledge.restricted_use import current_restricted_use
from agent.knowledge.restricted_use import drew_on_other_projects
from agent.observability.base_knowledge_scores import overdue_count
from agent.observability.langfuse_scores import RuntimeScore
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_trace_attributes import record_lessons
from agent.observability.langfuse_trace_attributes import record_trace_metadata
from agent.project_context import RequestContext
from agent.project_context import compose_project_context
from agent.project_context import get_user_message_id_from_context
from agent.stages import TurnFacts
from agent.stages.flags import TurnFlags
from agent.stages.flags import resolve_turn_flags
from agent.turn.context_client import ContextBlocks
from agent.turn.context_client import fetch_turn_context
from agent.turn.context_client import office_convention_lines
from agent.turn.context_client import personal_memory_lines
from agent.turn.context_client import with_base_knowledge

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TurnContext:
    project_context: str | None
    platform_lessons: str | None
    org_instructions: str | None
    stage_facts: TurnFacts
    deep_research_allowed: bool = True
    reference_projects: str | None = None
    workspace: str | None = None
    base_knowledge_labels: tuple[dict[str, object], ...] = ()
    knowledge_context: KnowledgeContext = UNAVAILABLE
    project_models: frozenset[str] | None = None
    tasks_allowed: bool = True
    licensed_text_allowed: bool = False
    restricted_scope: tuple[str, ...] = ()
    recorded_restricted: bool = False
    phase_facts: dict[str, float | str] = field(default_factory=dict)
    personal_memory: str | None = None
    temporary: bool = False

    @property
    def confined(self) -> bool:
        return bool(self.restricted_scope) or self.recorded_restricted


def thread_id_for_turn(conversation_id: str | None) -> str:
    if conversation_id:
        logger.info("Thread ID for checkpointing: %s", conversation_id)
        return conversation_id
    generated = str(uuid.uuid4())
    logger.info("No conversation-id header; generated thread ID: %s", generated)
    return generated


def turn_identity(request: RequestContext, conversation_id: str | None) -> dict[str, str | None]:
    return {
        "organization_id": request.organization_id,
        "user_id": request.user_id,
        "project_id": request.project_id,
        "conversation_id": conversation_id,
    }


def _claim(value: str | None) -> str | None:
    line = " ".join((value or "").split())
    return line or None


def user_info_for(request: RequestContext | None) -> dict[str, Any] | None:
    principal = get_current_principal()
    requester = (request.requester if request is not None else None) or {}
    token = (
        (_claim(principal.name), _claim(principal.email), _claim(principal.organization_name))
        if principal is not None
        else (None, None, None)
    )
    name, email, office = (
        token[0] or requester.get("name"),
        token[1] or requester.get("email"),
        token[2] or requester.get("organizationName"),
    )
    if principal is None and not (name or email or office):
        return None
    return {"name": name, "email": email, "office": office}


def signed_restricted_collections(request: RequestContext) -> list[str]:
    if not request.envelope_header:
        return []
    use = current_restricted_use()
    signed = restricted_collections_in(request.collection_scope)
    return signed if use is None else [name for name in signed if use.allows(name)]


def settle_restriction(context: TurnContext, request: RequestContext) -> TurnContext:
    use = current_restricted_use()
    drawable = tuple(signed_restricted_collections(request))
    recorded = bool(use is not None and use.confined) or drew_on_other_projects()
    if not drawable and not recorded:
        return context
    return replace(
        context,
        restricted_scope=drawable,
        recorded_restricted=recorded,
        deep_research_allowed=False,
        tasks_allowed=False,
    )


async def _live_memory_digest(
    request: RequestContext,
    query_text: str,
    *,
    fallback: str | None = None,
) -> str | None:
    if not (request.project_id or request.organization_id):
        return fallback
    try:
        return await asyncio.to_thread(
            fetch_memory_digest,
            project_id=request.project_id,
            organization_id=request.organization_id,
            query=query_text,
            user_id=request.user_id,
            restricted_collections=signed_restricted_collections(request),
        )
    except RuntimeError, OSError, ValueError:
        logger.warning("Live memory digest fetch failed; using connection-time digest", exc_info=True)
        return fallback


async def _bff_context_blocks(request: RequestContext, query_text: str) -> ContextBlocks:
    if not signed_restricted_collections(request):
        return await asyncio.to_thread(fetch_turn_context, request, query=query_text)
    blocks, live_digest = await asyncio.gather(
        asyncio.to_thread(fetch_turn_context, request, query=query_text),
        _live_memory_digest(request, query_text, fallback=None),
    )
    return replace(blocks, project_memory=live_digest if live_digest is not None else blocks.project_memory)


async def _context_blocks(request: RequestContext, query_text: str) -> ContextBlocks:
    if request.context_transport == "bff":
        return await _bff_context_blocks(request, query_text)
    memory_digest = await _live_memory_digest(request, query_text, fallback=request.project_memory)
    return ContextBlocks(request.project_context, memory_digest, request.org_instructions)


async def _turn_flags(request: RequestContext, resolve_stages: bool) -> TurnFlags:
    if not request.organization_id:
        return TurnFlags(enabled_stages=frozenset())
    flags = await resolve_turn_flags(
        organization_id=request.organization_id,
        memory_reflection_enabled=request.memory_reflection_enabled,
        project_id=request.project_id,
    )
    if resolve_stages:
        return flags
    return TurnFlags(
        enabled_stages=frozenset(),
        deep_research_allowed=flags.deep_research_allowed,
        tasks_allowed=flags.tasks_allowed,
        licensed_text_allowed=flags.licensed_text_allowed,
    )


async def _platform_lessons(conversation_id: str | None) -> LessonsResolution:
    try:
        return await asyncio.to_thread(resolve_platform_lessons, conversation_id)
    except Exception:  # noqa: BLE001 - an advisory digest must never cost the turn
        logger.warning("Platform-lessons digest fetch failed; continuing without", exc_info=True)
        return LessonsResolution(digest=None, arm="off")


def _signed_envelope(request: RequestContext) -> SignedEnvelope | None:
    if not request.envelope_header or not request.envelope_signature:
        return None
    return SignedEnvelope(header=request.envelope_header, signature=request.envelope_signature)


def _record_base_knowledge(blocks: ContextBlocks) -> None:
    if blocks.base_knowledge is None:
        return
    lines = blocks.base_knowledge.splitlines()
    record_trace_metadata(base_knowledge_entries=sum(1 for line in lines if line.startswith("- ")))
    overdue = overdue_count(blocks.base_knowledge_labels)
    emit_scores([RuntimeScore("base-knowledge-overdue", overdue)], writer="turn-context")


def _record_context_facts(blocks: ContextBlocks) -> None:
    if blocks.workspace is not None:
        record_trace_metadata(office_conventions_lines=office_convention_lines(blocks.workspace))
    _record_base_knowledge(blocks)
    record_trace_metadata(
        personal_memory_lines=personal_memory_lines(blocks.personal_memory),
        temporary_conversation=blocks.temporary,
    )


async def _load_turn_context(
    request: RequestContext,
    *,
    conversation_id: str | None,
    query_text: str,
    resolve_stages: bool,
) -> TurnContext:
    lessons, blocks, turn_flags = await asyncio.gather(
        _platform_lessons(conversation_id),
        _context_blocks(request, query_text),
        _turn_flags(request, resolve_stages),
    )
    record_lessons(lessons.arm, lessons.lesson_ids)
    _record_context_facts(blocks)
    if blocks.drew_on_other_projects and (cross := current_cross_project_turn()) is not None:
        cross.drew_on_others = True
    return TurnContext(
        project_context=compose_project_context(
            blocks.project_context, with_base_knowledge(blocks.project_memory, blocks.base_knowledge)
        ),
        platform_lessons=lessons.digest,
        org_instructions=blocks.org_instructions,
        reference_projects=blocks.reference_projects,
        workspace=blocks.workspace,
        base_knowledge_labels=blocks.base_knowledge_labels,
        knowledge_context=blocks.knowledge_context,
        project_models=blocks.project_models,
        phase_facts=blocks.timing,
        personal_memory=blocks.personal_memory,
        temporary=blocks.temporary,
        deep_research_allowed=turn_flags.deep_research_allowed,
        tasks_allowed=turn_flags.tasks_allowed,
        licensed_text_allowed=turn_flags.licensed_text_allowed,
        stage_facts=TurnFacts(
            conversation_id=conversation_id,
            ws_parent_id=get_user_message_id_from_context(),
            organization_id=request.organization_id,
            project_id=request.project_id,
            user_id=request.user_id,
            memory_digest=blocks.project_memory,
            federal_state=request.federal_state,
            enabled_stages=turn_flags.enabled_stages,
            personal_memory=blocks.personal_memory,
            temporary=blocks.temporary,
            envelope=_signed_envelope(request),
        ),
    )


async def load_turn_context(
    request: RequestContext,
    *,
    conversation_id: str | None,
    query_text: str,
    resolve_stages: bool,
) -> TurnContext:
    try:
        return await _load_turn_context(
            request, conversation_id=conversation_id, query_text=query_text, resolve_stages=resolve_stages
        )
    except Exception:  # noqa: BLE001 - only legacy requests can answer without context
        if request.context_transport == "bff":
            raise
        logger.warning("Project-context load failed; continuing without live context", exc_info=True)
        return TurnContext(
            project_context=None,
            platform_lessons=None,
            org_instructions=None,
            stage_facts=TurnFacts(),
        )
