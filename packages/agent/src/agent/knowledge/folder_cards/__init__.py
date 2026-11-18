from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass

from . import gate

logger = logging.getLogger(__name__)


def organization_hint(collection: str) -> str | None:
    try:
        from agent.common.cost_tracking import cost_tracker_var

        tracker = cost_tracker_var.get()
        if tracker is not None and tracker.organization_id:
            return tracker.organization_id
    except Exception:  # noqa: BLE001 — a hint, never a reason to fail
        pass
    try:
        from agent.project_context import get_organization_id_from_context

        organization_id = get_organization_id_from_context()
        if organization_id:
            return organization_id
    except Exception:  # noqa: BLE001
        pass
    try:
        from agent.common.source_kinds import office_shelf_organization_id

        return office_shelf_organization_id(collection)
    except Exception:  # noqa: BLE001
        return None


def organization_for(collection: str) -> str | None:
    hint = organization_hint(collection)
    if hint:
        return hint
    try:
        from . import queue

        return queue.organization_of(collection)
    except Exception:  # noqa: BLE001
        return None


def enabled_for_collection(collection: str) -> bool:
    return gate.enabled_for(organization_for(collection))


def mark_folders(collection: str, folder_paths: Iterable[str | None]) -> None:
    paths = [path for path in folder_paths if path and path.strip("/")]
    if not paths:
        return
    try:
        organization_id = organization_for(collection)
        if not gate.enabled_for(organization_id):
            return
        from . import queue

        queue.mark(collection, paths, organization_id)
    except Exception:  # noqa: BLE001 — a card is derived; a lost mark is found by the reconcile
        logger.warning("folder cards: could not mark %s in %s", paths, collection, exc_info=True)


def mark_files(collection: str, file_names: Sequence[str] | None, store=None) -> None:
    if not file_names or not enabled_for_collection(collection):
        return
    try:
        if store is None:
            from agent.knowledge.factory import _get_document_metadata_store

            store = _get_document_metadata_store()
        mark_folders(collection, store.get_folder_paths_batch(collection, list(file_names)).values())
    except Exception:  # noqa: BLE001
        logger.warning("folder cards: could not mark the folders of %d file(s)", len(file_names), exc_info=True)


@dataclass(frozen=True)
class ListedAbstract:
    abstract: str
    status: str
    generated_at: str | None


async def listing_abstracts(collections: Sequence[str]) -> dict[tuple[str, str], ListedAbstract]:
    if not collections:
        return {}
    from agent.project_context import get_organization_id_from_context

    from . import client

    organization_id = get_organization_id_from_context()
    if not organization_id or not await asyncio.to_thread(gate.enabled_for, organization_id):
        return {}

    def read(collection: str) -> dict[str, dict]:
        return client.get_cards(organization_id, collection, timeout=client.READ_TIMEOUT_SECONDS)

    replies = await asyncio.gather(
        *(asyncio.to_thread(read, collection) for collection in collections), return_exceptions=True
    )
    found: dict[tuple[str, str], ListedAbstract] = {}
    for collection, reply in zip(collections, replies, strict=True):
        if isinstance(reply, BaseException):
            logger.info("folder cards: none read for %s: %s", collection, reply)
            continue
        for path, card in reply.items():
            abstract = " ".join(str(card.get("abstract") or "").split())
            if abstract:
                found[(collection, path)] = ListedAbstract(
                    abstract, str(card.get("status") or "fresh"), card.get("generated_at")
                )
    return found
