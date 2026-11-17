from __future__ import annotations

import asyncio
import logging
from typing import Any

from .models import PassageTarget
from .revisions import _current_revision

logger = logging.getLogger("knowledge_layer.read_passage.tool")


def _document_names(document: Any) -> list[str]:
    names = [str(getattr(document, "file_name", "") or "")]
    stored = getattr(document, "display_title", None)
    if stored:
        names.append(str(stored))
    try:
        from agent.common.norm_registry import guess_display_title
        from agent.common.norm_registry import oib_family_member

        derived = guess_display_title(names[0])
        member = oib_family_member(names[0])
    except Exception:  # noqa: BLE001 — a missing title helper must not hide the file name
        derived = None
        member = None
    if derived:
        names.append(derived)
        head = derived.split(",", 1)[0].strip()
        if head and head != derived:
            names.append(head)
    if member:
        names += [f"OIB {member}", f"OIB-RL {member}", f"OIB-Richtlinie {member}"]
    seen: set[str] = set()
    unique: list[str] = []
    for name in names:
        if name.strip() and name.casefold() not in seen:
            seen.add(name.casefold())
            unique.append(name)
    return unique


def _matches(document: Any, wanted: str) -> bool:
    return any(name.strip().casefold() == wanted for name in _document_names(document))


async def _documents_in(collection: str) -> list[Any]:
    from agent.knowledge.factory import get_available_documents_async

    try:
        return await get_available_documents_async(collection)
    except Exception:  # noqa: BLE001 — one unreachable collection must not refuse the rest
        logger.warning("read_passage: document listing failed for %s", collection, exc_info=True)
        return []


async def _resolve_targets(entries: list[Any], document: str) -> list[PassageTarget]:
    wanted = document.strip().casefold()
    if not wanted:
        return []
    listings = await asyncio.gather(*(_documents_in(entry.collection) for entry in entries))
    targets: list[PassageTarget] = []
    for entry, docs in zip(entries, listings, strict=True):
        shelf = getattr(entry, "shelf", None)
        for candidate in docs:
            if not _matches(candidate, wanted):
                continue
            targets.append(
                PassageTarget(
                    collection=entry.collection,
                    file_name=str(getattr(candidate, "file_name", "")),
                    shelf=str(shelf) if shelf is not None else None,
                    current=_current_revision(candidate, docs),
                    mail_origin=getattr(candidate, "mail_origin", None),
                )
            )
    return targets
