from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from collections.abc import Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from dataclasses import field

from agent.cards.registry import CardRegistry
from agent.cards.registry import get_or_create_card_registry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.citations.registry import SourceRegistry
from agent.citations.session import get_or_create_session_registry
from agent.citations.session import persist_session_registry
from agent.citations.session import reset_session_registry
from agent.citations.session import set_session_registry
from agent.common.image_view_budget import begin_image_view_budget
from agent.common.image_view_budget import end_image_view_budget
from agent.common.image_view_budget import get_image_view_budget
from agent.knowledge.project_memory import TurnMemoryNote
from agent.knowledge.project_memory import begin_turn_memory_log
from agent.knowledge.project_memory import end_turn_memory_log
from agent.knowledge.project_memory import turn_memory_notes
from agent.knowledge.project_memory import turn_memory_writes
from agent.knowledge.project_memory import turn_restricted_memory_writes
from agent.memory.restriction import restricted_digest_notes
from agent.memory.shown_notes import ShownNotes
from agent.memory.shown_notes import bind_shown_notes
from agent.memory.shown_notes import load_shown_notes
from agent.memory.shown_notes import merged
from agent.memory.shown_notes import schedule_shown_notes_persist
from agent.memory.shown_notes import unbind_shown_notes

logger = logging.getLogger(__name__)


@dataclass
class TurnRegistries:

    cards: CardRegistry
    memory_writes: tuple[str, ...] = field(default_factory=tuple)
    memory_notes: tuple[TurnMemoryNote, ...] = field(default_factory=tuple)
    restricted_memory_writes: tuple[str, ...] = field(default_factory=tuple)
    source_collections: tuple[str, ...] = field(default_factory=tuple)
    shown_notes: ShownNotes = field(default_factory=ShownNotes)
    regions_viewed: int = 0


async def load_session_registry(conversation_id: str | None) -> SourceRegistry:
    try:
        return await asyncio.to_thread(get_or_create_session_registry, conversation_id)
    except Exception:  # noqa: BLE001 - a cold cache must not cost the turn its answer
        logger.warning("Session registry hydration failed; using a fresh registry", exc_info=True)
        return SourceRegistry()


async def load_turn_shown_notes(conversation_id: str | None) -> ShownNotes:
    try:
        return await asyncio.to_thread(load_shown_notes, conversation_id)
    except Exception:  # noqa: BLE001 - a cold cache must not cost the turn its answer
        logger.warning("Loading the restricted notes shown earlier failed; starting from none", exc_info=True)
        return ShownNotes()


def _registry_collections(registry: SourceRegistry) -> tuple[str, ...]:
    try:
        return tuple(dict.fromkeys(source.collection for source in registry.all_sources() if source.collection))
    except Exception:  # noqa: BLE001 - a stage fact is never worth a failed turn
        logger.warning("Could not read the citation registry's collections", exc_info=True)
        return ()


@asynccontextmanager
async def turn_registries(
    conversation_id: str,
    session_registry: SourceRegistry,
    *,
    memory_digest: str | None = None,
    shown_notes: ShownNotes | None = None,
    restricted_scope: Sequence[str] = (),
    temporary: bool = False,
    personal_memory: str | None = None,
    answer_message_id: str | None = None,
) -> AsyncIterator[TurnRegistries]:
    earlier = shown_notes or ShownNotes()
    cards = get_or_create_card_registry(conversation_id)
    cards.clear()
    registries = TurnRegistries(cards=cards, shown_notes=earlier)
    session_token = set_session_registry(session_registry)
    card_token = set_card_registry(cards)
    image_token = begin_image_view_budget()
    memory_token = begin_turn_memory_log(
        memory_digest, temporary=temporary, personal_memory=personal_memory, answer_message_id=answer_message_id
    )
    shown_token = bind_shown_notes(earlier)
    try:
        yield registries
    finally:
        registries.memory_writes = turn_memory_writes()
        registries.memory_notes = turn_memory_notes()
        registries.restricted_memory_writes = turn_restricted_memory_writes()
        registries.source_collections = _registry_collections(session_registry)
        budget = get_image_view_budget()
        registries.regions_viewed = budget.regions_viewed if budget is not None else 0
        unbind_shown_notes(shown_token)
        end_turn_memory_log(memory_token)
        end_image_view_budget(image_token)
        reset_card_registry(card_token)
        reset_session_registry(session_token)
        schedule_registry_persist(conversation_id)
        shown_now = [*restricted_digest_notes(memory_digest), *registries.restricted_memory_writes]
        if shown_now and restricted_scope:
            schedule_shown_notes_persist(conversation_id, merged(earlier, shown_now, restricted_scope))


_persist_tasks: set[asyncio.Task] = set()


async def _persist(conversation_id: str) -> None:
    try:
        await asyncio.to_thread(persist_session_registry, conversation_id)
    except Exception:  # noqa: BLE001 - a background write; there is nobody left to raise to
        logger.warning("Citation registry persistence failed for %s", conversation_id, exc_info=True)


def schedule_registry_persist(conversation_id: str) -> None:
    task = asyncio.get_running_loop().create_task(_persist(conversation_id))
    _persist_tasks.add(task)
    task.add_done_callback(_persist_tasks.discard)


def pending_persist_tasks() -> frozenset[asyncio.Task]:
    return frozenset(_persist_tasks)
