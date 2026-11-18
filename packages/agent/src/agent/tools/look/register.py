from __future__ import annotations

import asyncio
import logging
from typing import Any

from pydantic import Field

from agent.common.action_rows import ActionRow
from agent.common.image_view_budget import MAX_IMAGE_VIEWS_PER_TURN
from agent.common.image_view_budget import MAX_OVERVIEW_VIEWS_PER_TURN
from agent.observability.retrieval_trace import emit_step_span
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from ..canvas.calls import Refused
from ..canvas.presence import current_canvas_presence
from ..canvas.presence import show_reading
from .cards import looked_document
from .cards import note_look
from .place import PlaceFacts
from .place import document_licence
from .place import place_facts
from .place import render_place
from .resolve import Resolved
from .resolve import resolve_document

logger = logging.getLogger(__name__)

TOOL = "look"


def _default_max_dim() -> int:
    from knowledge_layer.view_image import default_max_dim

    return default_max_dim()


DESCRIPTION = (
    "Shows you a page of a document as an image; with `region=[x, y, w, h]` only that box, sharper. "
    "`document`: the file name from the inventory or from a hit's `Citation:` line, or a document id; empty means "
    "the document open on the canvas, then this chat's document. `page` starts at 1. `region` is shares of the "
    "page as shown: 0 to 1, origin top left, never pixels. `image_index` shows the embedded image a hit's "
    "`Image:` line names, at its own resolution; a hit's `Region:` line gives the numbers for the place it sits. "
    "Where something lies on a sheet is read off the image, not off the text. "
    "`question` (optional): a second reader, the office's vision model, answers it from the same crop as short "
    "lines starting `Gelesen:`, a reading of the drawing and never a measurement; a reading does not cost a "
    "look. A look's result carries its `[N]` to cite. A look that finds nothing is reported as absence in the "
    f"prose, not shown as a card. At most {MAX_IMAGE_VIEWS_PER_TURN} looks per turn, at most "
    f"{MAX_OVERVIEW_VIEWS_PER_TURN} of them whole pages; every result says how many are left. Fails open with a "
    "sentence saying why."
)


class LookToolConfig(FunctionBaseConfig, name="look"):
    max_dim: int = Field(
        default_factory=_default_max_dim,
        description="Long edge (px) of what `look` renders; higher is sharper, larger payloads.",
    )
    timeout: float = Field(default=30.0, description="Render timeout of `look`, in seconds.")


def _may_glow(resolved: Resolved) -> bool:
    return resolved.target is not None and resolved.signed is not None and current_canvas_presence() is not None


def _observe(
    document: str, page: int, region: Any, image_index: Any, result: Any, resolved: Any, *, asked: bool = False
) -> None:
    emit_step_span(
        TOOL,
        {
            "page": page,
            "region": region is not None,
            "image_index": image_index is not None,
            "named": bool((document or "").strip()),
            "question": asked,
        },
        {
            "viewed": isinstance(result, list),
            "workspace": isinstance(resolved, Resolved) and resolved.target is not None,
        },
    )


async def _licence_of(resolved: Any) -> Any:
    from agent.common.licensed_text import LICENSED
    from agent.common.licensed_text import LicenceTerms
    from agent.common.source_kinds import Shelf
    from agent.common.source_kinds import legacy_shelf_for_collection_name

    collection = (getattr(resolved, "collection", "") or "").strip()
    unknown = LicenceTerms(licence_class=LICENSED)
    if not collection:
        return None if getattr(resolved, "target", None) is None else unknown
    office = legacy_shelf_for_collection_name(collection) == Shelf.OFFICE_SHELF
    return await asyncio.to_thread(document_licence, collection, resolved.file_name, unknown if office else None)


def refuse_unattested_look(licence: Any) -> None:
    if licence is not None and licence.licensed and not licence.ai_processing:
        raise Refused(
            "This page belongs to the office's licensed copy of a standard, and the office has not confirmed that its "
            "licence covers processing by AI services: it is not looked at. Name the document, page and clause."
        )


async def _licensed_blocks(
    view: Any, question: str, place: PlaceFacts | None, licence: Any
) -> tuple[list[dict], str, str]:
    from agent.common.licensed_text import current_capture
    from agent.common.licensed_text import licensed_document_scope

    from .reading import DEFAULT_QUESTION
    from .reading import read_region
    from .reading import render_readings

    capture = current_capture()
    if place is None or capture is None or not capture.text_allowed:
        return [{"type": "text", "text": "This page belongs to a licensed copy no look may read."}], "", ""
    with licensed_document_scope(licence):
        reading = await read_region(view.jpeg, question.strip() or DEFAULT_QUESTION, region=True)
    body = f"{view.text}\n\n{render_readings(reading, blind=True)}"
    return (
        [
            {
                "type": "text",
                "text": render_place(place, "A look at a page of the office's licensed copy.", body, licence),
            }
        ],
        "",
        "",
    )


async def _blocks_for(
    view: Any, question: str, sees: bool | None, region: Any, place: PlaceFacts | None = None, licence: Any = None
) -> tuple[list[dict], str, str]:
    from .reading import DEFAULT_QUESTION
    from .reading import card_reading
    from .reading import read_region
    from .reading import render_readings
    from .reading import render_readings_parts

    if licence is not None and licence.licensed:
        return await _licensed_blocks(view, question, place, licence)
    blind = sees is False
    question = question.strip() or (DEFAULT_QUESTION if blind else "")
    if not question:
        return view.blocks(), "", ""
    reading = await read_region(view.jpeg, question, region=region is not None)
    if place is not None and reading.usable:
        head, rows = render_readings_parts(reading, blind=blind)
        text = render_place(place, f"{view.text}\n\n{head}", rows)
    else:
        text = f"{view.text}\n\n{render_readings(reading, blind=blind)}"
    blocks = view.with_text(text).blocks()
    kept = card_reading(reading)
    read = "\n".join([*(line.text for line in reading.lines), reading.summary]).strip() if reading.usable else ""
    return (blocks[:1] if blind else blocks), kept, read


async def run_look(
    document: str = "",
    page: int = 1,
    region: list[float] | None = None,
    image_index: int | None = None,
    question: str = "",
    *,
    limits: Any = None,
) -> list[dict] | str:
    row = ActionRow("look", target=(document or "").strip(), pages=str(page))
    try:
        result, resolved = await _run_look(document, page, region, image_index, question, limits=limits)
    except BaseException:
        row.finish("error")
        raise
    row.finish("ok" if isinstance(result, list) else "error", **_row_document(resolved))
    return result


def _row_document(resolved: Resolved | str | None) -> dict[str, str]:
    from agent.knowledge.restricted_use import may_name

    if not isinstance(resolved, Resolved) or not may_name(resolved.collection):
        return {}
    document = looked_document(resolved)
    return {"target": document["name"], **({"document_id": document["id"]} if document.get("id") else {})}


async def _run_look(
    document: str,
    page: int,
    region: list[float] | None,
    image_index: int | None,
    question: str,
    *,
    limits: Any,
) -> tuple[list[dict] | str, Resolved | str | None]:
    from knowledge_layer.view_image import View
    from knowledge_layer.view_image import render_view
    from knowledge_layer.view_image import turn_sees

    resolved: Resolved | str | None = None
    try:
        resolved = await resolve_document(document)
        if isinstance(resolved, str):
            result: list[dict] | str = resolved
        else:
            render = render_view(
                resolved.file_name, page, resolved.collection, image_index, region, limits=limits, tool=TOOL
            )
            if _may_glow(resolved):
                _, rendered = await asyncio.gather(
                    show_reading(resolved.target.body(), resolved.target.document_id, resolved.signed, page, region),
                    render,
                )
            else:
                rendered = await render
            if isinstance(rendered, View):
                place = place_facts(resolved, page, rendered.region, image_index)
                licence = await _licence_of(resolved)
                refuse_unattested_look(licence)
                sees = await turn_sees()
                result, reading, read = await _blocks_for(rendered, question or "", sees, region, place, licence)
                note_look(
                    resolved,
                    page,
                    rendered.region,
                    image_index,
                    question,
                    reading=reading,
                    read=read,
                    revision_id=rendered.version_id,
                )
            else:
                result = rendered
    except Refused as refused:
        result = refused.message
    _observe(document, page, region, image_index, result, resolved, asked=bool((question or "").strip()))
    return result, resolved


@register_function(config_type=LookToolConfig)
async def look(config: LookToolConfig, _builder: Builder):
    from knowledge_layer.view_image import ViewLimits

    limits = ViewLimits(max_dim=config.max_dim, timeout=config.timeout)

    async def _look(
        document: str = "",
        page: int = 1,
        region: list[float] | None = None,
        image_index: int | None = None,
        question: str = "",
    ) -> list[dict] | str:
        return await run_look(document, page, region, image_index, question, limits=limits)

    yield FunctionInfo.from_fn(_look, description=DESCRIPTION)
