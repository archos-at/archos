from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent.common.grounding_block import GroundingBlock
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import SourceRegion
from agent.common.grounding_block import render_grounding_block
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import legacy_shelf_for_collection_name

TOOL = "look"


@dataclass(frozen=True)
class PlaceFacts:
    file_name: str
    collection: str
    shelf: Shelf
    page: int
    box: tuple[float, float, float, float] | None = None


def place_facts(resolved: Any, page: int, region: Any, image_index: int | None) -> PlaceFacts | None:
    from .cards import clamp_region

    collection = (getattr(resolved, "collection", "") or "").strip()
    if not collection:
        return None
    shelf = legacy_shelf_for_collection_name(collection)
    if shelf is None or shelf == Shelf.BASE:
        return None
    box = clamp_region(region) if image_index is None else None
    corners = (box[0], box[1], round(box[0] + box[2], 4), round(box[1] + box[3], 4)) if box is not None else None
    return PlaceFacts(resolved.file_name, collection, shelf, max(1, int(page or 1)), corners)


def citation_key(facts: PlaceFacts) -> str:
    return f"{facts.file_name}, p.{facts.page}"


def document_licence(collection: str, file_name: str, unindexed: Any = None) -> Any:
    from agent.knowledge.licences import document_licence as read

    return read(collection, file_name, unindexed=unindexed)


def render_place(facts: PlaceFacts, preamble: str, reading_rows: str, licence: Any = None) -> str:
    hit = GroundingHit(
        citation_key=citation_key(facts),
        file_name=facts.file_name,
        page=facts.page,
        shelf=facts.shelf,
        collection=facts.collection,
        doc_class=None,
        display_title=facts.file_name,
        folder_path=None,
        clause=None,
        score=1.0,
        content_type="drawing",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=reading_rows,
        regions=(SourceRegion(box=facts.box),) if facts.box is not None else (),
        licence=licence,
    )
    block = GroundingBlock(preamble=preamble, degraded_banner="", hits=(hit,), lanes=(), tool=TOOL)
    return render_grounding_block(block)
