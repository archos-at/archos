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
    from knowledge_layer.document_address import addressed

    if not document.strip():
        return []
    listings = await asyncio.gather(*(_documents_in(entry.collection) for entry in entries))
    listed = [(entry, docs, candidate) for entry, docs in zip(entries, listings, strict=True) for candidate in docs]
    targets: list[PassageTarget] = []
    for entry, docs, candidate in addressed(
        listed,
        document,
        names=lambda row: _document_names(row[2]),
        folder=lambda row: getattr(row[2], "folder_path", None),
        document_id=lambda row: _document_id(row[2]),
    ):
        shelf = getattr(entry, "shelf", None)
        targets.append(
            PassageTarget(
                collection=entry.collection,
                file_name=str(getattr(candidate, "file_name", "")),
                shelf=str(shelf) if shelf is not None else None,
                current=_current_revision(candidate, docs),
                mail_origin=getattr(candidate, "mail_origin", None),
                document_id=_document_id(candidate),
                folder_path=str(getattr(candidate, "folder_path", None) or "").strip().strip("/"),
            )
        )
    return targets


def _document_id(document: Any) -> str | None:
    return str(getattr(document, "document_id", None) or "") or None


def namesakes_refusal(document: str, targets: list[PassageTarget]) -> str:
    from knowledge_layer.document_address import citation_form

    held = {target.document_id: target for target in targets if target.document_id}
    if len(held) < 2:
        return ""
    listed = "\n".join(
        f"- {citation_form(target.folder_path, target.file_name)} (Document-ID: {document_id})"
        for document_id, target in sorted(
            held.items(), key=lambda item: citation_form(item[1].folder_path, item[1].file_name).casefold()
        )
    )
    return (
        f"{document!r} names {len(held)} different documents, and this tool never reads two as one. "
        "Pass one of them as `document=`, by its folder path or its Document-ID:\n" + listed
    )


def reading_label(document: str, targets: list[PassageTarget]) -> str:
    from knowledge_layer.document_address import citation_form
    from knowledge_layer.document_address import names_document_id

    if len(targets) != 1 or not names_document_id(document, targets[0].document_id):
        return document
    target = targets[0]
    return citation_form(target.folder_path, target.file_name) if target.folder_path else target.file_name
