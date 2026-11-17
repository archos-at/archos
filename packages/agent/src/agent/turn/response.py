from __future__ import annotations

import dataclasses
import uuid
from typing import TYPE_CHECKING
from typing import Any

from agent.common.canned_replies import NO_RESPONSE_TEXT
from agent.common.wire_v2 import ConfidenceCheck
from agent.common.wire_v2 import KeyedCard
from agent.common.wire_v2 import QuoteStamp
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import RunHandoff
from agent.common.wire_v2 import TurnResult
from agent.common.wire_v2 import card_key
from agent.knowledge.project_memory import TurnMemoryNote
from agent.knowledge.restricted_use import drew_on_other_projects
from agent.memory.restriction import RestrictionEvidence
from agent.memory.restriction import restricted_digest_notes
from agent.memory.restriction import restriction_evidence
from agent.memory.shown_notes import ShownNotes
from agent.stages import TurnFacts

if TYPE_CHECKING:
    from agent.core.models import ConversationState


def answer_message_id(conversation_id: str | None, turn_id: str | None) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"grid:assistant:{conversation_id}:{turn_id or 'default'}"))


def turn_answer_message_id(conversation_id: str | None) -> str:
    from agent.project_context import get_user_message_id_from_context

    return answer_message_id(conversation_id, get_user_message_id_from_context())


def answer_text(state: ConversationState) -> str:
    if not state.messages:
        return NO_RESPONSE_TEXT
    content = state.messages[-1].content
    return content if isinstance(content, str) else str(content)


def _run_handoff(state: ConversationState) -> RunHandoff | None:
    if state.run_id and state.run_message_id:
        return RunHandoff(run_id=state.run_id, run_message_id=state.run_message_id)
    return None


def build_result(state: ConversationState, cards: list[dict[str, Any]], message_id: str) -> TurnResult:
    skills_activated = list(state.skills_activated or [])
    return TurnResult(
        message_id=message_id,
        text=answer_text(state),
        cards=[KeyedCard(key=card_key(card), card=card) for card in cards],
        sources=list(state.verified_sources or []),
        read_sources=list(state.read_sources or []),
        answer_meta=state.answer_meta or None,
        answer_confidence=state.answer_confidence,
        answer_confidence_reason=state.answer_confidence_reason or None,
        answer_confidence_capped_reason=state.answer_confidence_capped_reason,
        routing_decision=state.routing_decision,
        escalation_reason=state.escalation_reason or None,
        citations_removed=state.citations_removed or None,
        research_truncated=bool(state.research_truncated),
        job_admission_rejected=bool(state.job_admission_rejected),
        retry_after_seconds=state.retry_after_seconds if state.job_admission_rejected else None,
        skills_activated=skills_activated,
        skills_hidden=list(state.skills_hidden or []) if skills_activated else [],
        retrieval_ledger=list(state.retrieval_ledger or []),
        quote_stamps=[QuoteStamp.model_validate(stamp) for stamp in state.quote_stamps or []],
        confidence_check=ConfidenceCheck.model_validate(state.confidence_check) if state.confidence_check else None,
        answer_confidence_version=state.answer_confidence_version if state.answer_confidence else None,
        lookup_found_nothing=bool(state.lookup_found_nothing),
        run=_run_handoff(state),
        reasoning_effort=state.reasoning_effort,
    )


def finished(result: TurnResult) -> RunFinishedBody:
    if result.run is not None:
        return RunFinishedBody(outcome="handed_off", result=result)
    if result.job_admission_rejected:
        return RunFinishedBody(outcome="refused", result=result)
    return RunFinishedBody(outcome="answered", result=result)


def emitted_card_types(cards: object) -> frozenset[str]:
    types: set[str] = set()
    for card in cards or ():
        card_type = card.get("type") if isinstance(card, dict) else getattr(card, "type", None)
        if isinstance(card_type, str) and card_type:
            types.add(card_type)
    return frozenset(types)


def _source_collections(sources: object) -> list[str]:
    collections: list[str] = []
    for source in sources or ():
        collection = source.get("collection") if isinstance(source, dict) else getattr(source, "collection", None)
        if isinstance(collection, str) and collection:
            collections.append(collection)
    return collections


def turn_restriction_evidence(
    state: ConversationState,
    *,
    registry_collections: tuple[str, ...] = (),
    listed_documents: tuple[Any, ...] = (),
    restricted_notes: tuple[str, ...] = (),
    earlier_notes: ShownNotes | None = None,
) -> RestrictionEvidence:
    earlier = earlier_notes or ShownNotes()
    return restriction_evidence(
        state.collection_scope,
        source_collections=[
            *_source_collections(state.verified_sources),
            *_source_collections(state.read_sources),
            *registry_collections,
        ],
        listed_documents=listed_documents or state.available_documents or (),
        restricted_notes=restricted_notes,
        earlier_notes=earlier.notes,
        always=earlier.overflowed,
    )


def post_answer_turn_facts(
    request_facts: TurnFacts,
    *,
    state: ConversationState,
    query_text: str,
    cards: object,
    remembered_this_turn: tuple[str, ...] = (),
    noted_this_turn: tuple[TurnMemoryNote, ...] = (),
    registry_collections: tuple[str, ...] = (),
    listed_documents: tuple[Any, ...] = (),
    restricted_memory_writes: tuple[str, ...] = (),
    earlier_restricted_notes: ShownNotes | None = None,
) -> TurnFacts:
    return dataclasses.replace(
        request_facts,
        query=query_text,
        answer=answer_text(state),
        routing_decision=state.routing_decision,
        research_truncated=bool(state.research_truncated),
        run_id=state.run_id,
        emitted_card_types=emitted_card_types(cards),
        answer_confidence=state.answer_confidence,
        remembered_this_turn=remembered_this_turn,
        noted_this_turn=noted_this_turn,
        drew_on_other_projects=drew_on_other_projects(),
        restriction=turn_restriction_evidence(
            state,
            registry_collections=registry_collections,
            listed_documents=listed_documents,
            restricted_notes=(*restricted_digest_notes(request_facts.memory_digest), *restricted_memory_writes),
            earlier_notes=earlier_restricted_notes,
        ),
    )
