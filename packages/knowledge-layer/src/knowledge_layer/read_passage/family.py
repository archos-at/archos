from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .fetch import _fetch_query
from .models import PassageTarget
from .outline import _MAX_OUTLINE_LINES
from .outline import _OUTLINE_INSTRUCTION
from .outline import OutlineEntry
from .outline import _outline_lines
from .outline import _scope_chunks
from .outline import outline_for
from .targets import _documents_in

logger = logging.getLogger("knowledge_layer.read_passage.tool")

_MAX_FAMILY_SCOPE_CHUNKS = 2


@dataclass(frozen=True)
class FamilyMember:
    number: str
    title: str
    chunks: tuple[Any, ...]
    entries: tuple[OutlineEntry, ...]
    structural: bool = False


@dataclass(frozen=True)
class FamilyOverview:
    label: str
    members: tuple[FamilyMember, ...]
    chunks: tuple[Any, ...]
    trailer: str
    structural: bool = False

    @property
    def opened_files(self) -> frozenset[str]:
        return frozenset(chunk.file_name for chunk in self.chunks if getattr(chunk, "file_name", None))

    @property
    def preamble(self) -> str:
        numbers = ", ".join(member.number for member in self.members)
        count = f"{len(self.members)} part" if len(self.members) == 1 else f"{len(self.members)} parts"
        span = "Result 1 is" if len(self.chunks) == 1 else f"Results 1 to {len(self.chunks)} are"
        return (
            f"{self.label}: {count} in the corpus ({numbers}).\n"
            f"{span} the Geltungsbereich of these parts, their Gliederungen are below; "
            "the results for the query follow.\n"
            "These parts are therefore open at the level a read of one document opens it at; "
            "deeper goes only a single Punkt from a Gliederung, as described below."
        )


class FamilyUnreadable(RuntimeError): ...


def _family_trailer(members: Sequence[FamilyMember]) -> str:
    budget = max(1, _MAX_OUTLINE_LINES // max(1, len(members)))
    lines: list[str] = []
    for member in members:
        lines += [f"## Gliederung {member.title}", *_outline_lines(member.entries, budget), ""]
    return "\n".join([*lines, _OUTLINE_INSTRUCTION, ""])


def _member_title(file_name: str) -> str:
    from agent.common.norm_registry import guess_display_title

    try:
        return guess_display_title(file_name) or file_name
    except Exception:  # noqa: BLE001 — a missing title helper must not hide the file
        return file_name


async def _corpus_families(base: Any) -> list[Any]:
    from agent.common.norm_registry import oib_families
    from agent.common.source_kinds import Shelf

    try:
        from agent.knowledge.inventory import get_norm_families
        from agent.knowledge.inventory import get_turn_documents

        families = list(get_norm_families())
        if families:
            return families
        rows = [
            str(getattr(row, "file_name", "") or "")
            for row in get_turn_documents()
            if str(getattr(row, "shelf", "") or "") == str(Shelf.BASE)
        ]
        if rows:
            return oib_families(rows)
    except Exception:  # noqa: BLE001 — no turn bound is a valid standalone run
        logger.debug("No turn inventory for the family lookup", exc_info=True)
    documents = await _documents_in(base.collection)
    return oib_families(str(getattr(document, "file_name", "") or "") for document in documents)


async def _read_member(target: PassageTarget, number: str) -> FamilyMember | None:
    outline = await outline_for([target], _fetch_query(target.file_name, None, None))
    if not outline.chunks:
        if outline.failures:
            logger.warning("Family member %s could not be read", target.file_name, exc_info=outline.failures[0])
        return None
    return FamilyMember(
        number=number,
        title=_member_title(target.file_name),
        chunks=tuple(_scope_chunks(outline.chunks)[:_MAX_FAMILY_SCOPE_CHUNKS]),
        entries=tuple(entry for entry in outline.entries if entry.depth == 1),
        structural=outline.structural,
    )


async def family_overview(entries: Sequence[Any], family_key: str) -> FamilyOverview | None:
    from agent.common.source_kinds import Shelf

    base = next((entry for entry in entries if getattr(entry, "shelf", None) is Shelf.BASE), None)
    if base is None:
        return None
    family = next((item for item in await _corpus_families(base) if item.key == family_key), None)
    if family is None:
        return None
    read = await asyncio.gather(
        *(
            _read_member(PassageTarget(base.collection, file_name, str(base.shelf)), number)
            for number, file_name in zip(family.members, family.files, strict=True)
        ),
        return_exceptions=True,
    )
    for failure in (item for item in read if isinstance(item, BaseException)):
        logger.warning("Family member skipped", exc_info=failure)
    members = tuple(item for item in read if isinstance(item, FamilyMember))
    if not members:
        raise FamilyUnreadable(f"no part of {family.label} could be read")
    chunks = tuple(chunk for member in members for chunk in member.chunks)
    logger.info("Family overview: %s read %d member(s)", family.label, len(members))
    return FamilyOverview(
        label=family.label,
        members=members,
        chunks=chunks,
        trailer=_family_trailer(members),
        structural=all(member.structural for member in members),
    )
