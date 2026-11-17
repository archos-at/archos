from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Iterable
from dataclasses import dataclass
from dataclasses import field

from agent.common.profiler import profiled_span
from agent.common.retrieval_status import documents_waiting_step
from agent.common.source_kinds import Shelf
from agent.common.wire_v2 import StatusStep
from agent.knowledge import get_available_documents_async
from agent.knowledge import ingest_status_store
from agent.knowledge.inventory import allocate_inventory_detailed
from agent.knowledge.inventory import get_inventory_drops
from agent.knowledge.inventory import get_norm_families
from agent.knowledge.inventory import set_inventory_drops
from agent.knowledge.inventory import set_norm_families
from agent.knowledge.inventory import stamp_document
from agent.knowledge.scoping import ScopedCollection
from agent.turn.admission import spanned

logger = logging.getLogger(__name__)

INGEST_WAIT_SECONDS_DEFAULT = 20.0
INGEST_POLL_SECONDS = 1.0
AVAILABLE_DOCUMENTS_DEFAULT_LIMIT = 50

FetchOne = Callable[[str], Awaitable[list]]
ReadInFlight = Callable[[list[str]], dict[str, list[str]]]


def available_documents_limit() -> int:
    raw = os.environ.get("AVAILABLE_DOCUMENTS_MAX", "")
    try:
        return int(raw) if raw.strip() else AVAILABLE_DOCUMENTS_DEFAULT_LIMIT
    except ValueError:
        logger.warning("AVAILABLE_DOCUMENTS_MAX=%r is not an integer; using %d", raw, AVAILABLE_DOCUMENTS_DEFAULT_LIMIT)
        return AVAILABLE_DOCUMENTS_DEFAULT_LIMIT


def ingest_wait_seconds() -> float:
    raw = os.environ.get("INGEST_WAIT_SECONDS")
    if raw is None or not raw.strip():
        return INGEST_WAIT_SECONDS_DEFAULT
    try:
        return max(0.0, float(raw))
    except ValueError:
        logger.warning("INGEST_WAIT_SECONDS=%r is not a number; using %s", raw, INGEST_WAIT_SECONDS_DEFAULT)
        return INGEST_WAIT_SECONDS_DEFAULT


def session_collection_name(conversation_id: str) -> str:
    return conversation_id if conversation_id.startswith("s_") else f"s_{conversation_id}"


def base_collection_name() -> str:
    return os.environ.get("COLLECTION_NAME") or os.environ.get("OIB_COLLECTION_NAME") or "oib_knowledge"


def fallback_scope(conversation_id: str | None) -> list[ScopedCollection]:
    scope = [ScopedCollection(base_collection_name(), Shelf.BASE)]
    if not conversation_id:
        return scope
    session = session_collection_name(conversation_id)
    if session != scope[0].collection:
        scope.append(ScopedCollection(session, Shelf.SESSION))
    return scope


def resolve_scope(header_scope: list[ScopedCollection] | None, conversation_id: str | None) -> list[ScopedCollection]:
    return list(header_scope) if header_scope else fallback_scope(conversation_id)


def shelves_in_scope(scope: Iterable[ScopedCollection]) -> list[str]:
    return [str(entry.shelf) for entry in scope if entry.shelf is not None]


def _base_families(docs: Iterable) -> list:
    from agent.common.norm_registry import oib_families

    names = [
        getattr(doc, "file_name", "")
        for doc in docs
        if getattr(doc, "shelf", None) == Shelf.BASE and getattr(doc, "file_name", "")
    ]
    return oib_families(names)


async def _stamped_rows(collections: Iterable[ScopedCollection], fetch_one: FetchOne) -> list:

    async def _guarded(entry: ScopedCollection):
        try:
            return entry, await fetch_one(entry.collection)
        except Exception as exc:  # noqa: BLE001 - one shelf's outage must not empty the others
            logger.warning("No document summaries for collection %s: %s", entry.collection, exc)
            return entry, []

    per_collection = await asyncio.gather(*(_guarded(entry) for entry in collections))
    return [
        stamp_document(doc, collection=entry.collection, shelf=entry.shelf)
        for entry, docs in per_collection
        for doc in docs or []
    ]


def _cap_for_prompt(aggregated: list, max_documents: int | None = None) -> list:
    set_norm_families(_base_families(aggregated))

    limit = available_documents_limit() if max_documents is None else max_documents
    before = len(aggregated)
    kept, dropped = allocate_inventory_detailed(aggregated, limit)
    set_inventory_drops(dropped)
    if limit and limit > 0 and before > len(kept):
        logger.info("Capping available_documents from %d to %d (AVAILABLE_DOCUMENTS_MAX)", before, len(kept))
    return kept


async def aggregate_documents_across_collections(
    collections: Iterable[ScopedCollection],
    fetch_one: FetchOne,
    max_documents: int | None = None,
) -> list:
    return _cap_for_prompt(await _stamped_rows(collections, fetch_one), max_documents)


async def load_available_documents(scope: list[ScopedCollection], fetch_one: FetchOne) -> tuple[list | None, list]:
    every_row = await _stamped_rows(scope, fetch_one)
    aggregated = _cap_for_prompt(list(every_row))
    names = [entry.collection for entry in scope]
    if not aggregated:
        logger.info("No document summaries in DB for collections %s", names)
        return None, every_row
    logger.info("Loaded %d document summaries across collections %s", len(aggregated), names)
    return aggregated, every_row


async def await_ingest_settling(
    scope_names: list[str],
    pending: dict[str, list[str]],
    *,
    read: ReadInFlight,
    timeout_seconds: float | None = None,
    poll_seconds: float = INGEST_POLL_SECONDS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> dict[str, list[str]]:
    if not pending:
        return pending
    budget = ingest_wait_seconds() if timeout_seconds is None else timeout_seconds
    if budget <= 0:
        return pending

    loop = asyncio.get_running_loop()
    deadline = loop.time() + budget
    current = pending
    while current and loop.time() < deadline:
        await sleep(min(poll_seconds, max(0.0, deadline - loop.time())))
        current = await asyncio.to_thread(read, scope_names)
    if current:
        logger.info(
            "Ingest wait expired after %.0fs with %d file(s) still pending", budget, sum(map(len, current.values()))
        )
    else:
        logger.info("Ingest wait cleared: the turn proceeds with the new file(s) indexed")
    return current


HOLDING_SHELVES = frozenset({Shelf.SESSION})


def held_uploads(scope: Iterable[ScopedCollection], pending: dict[str, list[str]]) -> dict[str, list[str]]:
    holding = {entry.collection for entry in scope if entry.shelf in HOLDING_SHELVES}
    return {collection: names for collection, names in pending.items() if collection in holding and names}


def in_flight_names(pending: dict[str, list[str]]) -> list[str]:
    names: list[str] = []
    for batch in pending.values():
        names.extend(name for name in batch if name not in names)
    return names


@dataclass(frozen=True)
class Inventory:

    available_documents: list | None
    in_flight_documents: list[str] | None
    norm_families: tuple = ()
    inventory_drops: dict = field(default_factory=dict)
    pending: dict[str, list[str]] = field(default_factory=dict)
    all_documents: tuple = field(default=(), compare=False)


async def load_inventory(
    scope: list[ScopedCollection],
    *,
    fetch_one: FetchOne | None = None,
    read_in_flight: ReadInFlight | None = None,
) -> Inventory:
    fetch_one = fetch_one or get_available_documents_async
    read_in_flight = read_in_flight or ingest_status_store.in_flight_files
    try:
        (documents, families, drops, every_row), pending = await asyncio.gather(
            spanned("setup.available_documents", _documents_and_families(scope, fetch_one)),
            spanned("setup.ingest_status", asyncio.to_thread(read_in_flight, [entry.collection for entry in scope])),
        )
    except Exception:  # noqa: BLE001 - see above; an answer without the inventory beats no answer
        logger.warning("Document inventory load failed; continuing without one", exc_info=True)
        return Inventory(None, None)
    held = held_uploads(scope, pending)
    return Inventory(documents, in_flight_names(pending) or None, families, drops, held, every_row)


def pending_uploads(inventory: Inventory) -> StatusStep | None:
    if not inventory.pending or ingest_wait_seconds() <= 0:
        return None
    return documents_waiting_step(file_count=sum(len(names) for names in inventory.pending.values()))


async def wait_for_uploads(
    scope: list[ScopedCollection],
    inventory: Inventory,
    *,
    fetch_one: FetchOne | None = None,
    read_in_flight: ReadInFlight | None = None,
    timeout_seconds: float | None = None,
) -> Inventory:
    if not inventory.pending:
        return inventory
    try:
        with profiled_span("setup.ingest_wait"):
            return await _hold(
                scope,
                inventory,
                fetch_one=fetch_one or get_available_documents_async,
                read_in_flight=read_in_flight or ingest_status_store.in_flight_files,
                timeout_seconds=timeout_seconds,
            )
    except Exception:  # noqa: BLE001 - the inventory already read beats no answer
        logger.warning("Waiting for uploads failed; continuing with the inventory as read", exc_info=True)
        return inventory


async def _hold(
    scope: list[ScopedCollection],
    inventory: Inventory,
    *,
    fetch_one: FetchOne,
    read_in_flight: ReadInFlight,
    timeout_seconds: float | None,
) -> Inventory:
    pending = inventory.pending
    settled = await await_ingest_settling(list(pending), pending, read=read_in_flight, timeout_seconds=timeout_seconds)
    if settled == pending:
        return inventory
    documents, families, drops, every_row = await _documents_and_families(scope, fetch_one)
    finished = set(in_flight_names(pending)) - set(in_flight_names(settled))
    in_flight = [name for name in inventory.in_flight_documents or [] if name not in finished]
    return Inventory(documents, in_flight or None, families, drops, settled, every_row)


async def _documents_and_families(
    scope: list[ScopedCollection], fetch_one: FetchOne
) -> tuple[list | None, tuple, dict, tuple]:
    documents, every_row = await load_available_documents(scope, fetch_one)
    return documents, tuple(get_norm_families()), dict(get_inventory_drops()), tuple(every_row)
