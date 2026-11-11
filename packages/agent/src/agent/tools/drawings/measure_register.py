"""``drawing_measure``: a page of a PDF drawing, read and measured as geometry (ADR-0182).

``look`` shows the agent a page and a vision model reads it. This tool reads
what the file itself holds: the printed figures as characters, the linework as
segments, the scale each region stores. A number it returns was computed by the
engine (``agent.drawings.sheet_measure``) from the two faces or the corners the
ENGINE tied the caller's points to, never by a model, and it carries its
interval, its provenance and the scale it rests on. Where the scale is not a
person's or corroborated by the sheet's own figures, there is no number.

Separate from ``dxf_measure`` (a DXF is a site of parcels; a PDF sheet is a
page of regions).

**Behind the ``drawing-measure`` entitlement at the call, not only at the
binding.** The BFF states the kind ``pdf`` for a turn only where the
organization holds the entitlement and the project a PDF; ``turn_tools`` binds
the tool from that, and :func:`run_drawing_measure` asks it again. A run that
binds the boot set without a turn's scope (a job's chat agent, the internal
tools route) states nothing and is refused.

The engine's work runs off the event loop under :data:`ANSWER_TIMEOUT_S`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from agent.common.passage_fence import fence
from agent.common.turn_file_kinds import turn_states
from agent.common.turn_status import record_lane_hit
from agent.drawings import sheet_listing
from agent.drawings import sheet_measure
from agent.drawings.sheet_answers import Answer
from agent.drawings.sheet_answers import NoNumber
from agent.drawings.sheet_answers import render
from agent.drawings.sheet_figures import Kind
from agent.drawings.sheet_listing import Listing
from agent.drawings.sheet_measure import Request
from agent.knowledge.restricted_use import may_name
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from .sheet_source import LoadedSheet
from .sheet_source import load_sheet

logger = logging.getLogger(__name__)

Operation = Literal["sheet", "figures", "rooms", "scale_check", "clearance", "distance", "path", "area"]
MEASURING: frozenset[str] = frozenset({"clearance", "distance", "path", "area"})
#: One operation over a loaded sheet may take this long. The engine bounds its own work (the figures a scale
#: check looks at, the segments a page may hold); this is the backstop that keeps a turn from waiting on a file.
ANSWER_TIMEOUT_S = 30
NOT_ENABLED = (
    "drawing_measure is not available in this conversation: measuring from PDF drawings is not switched on for "
    "this organization, or this run has no project with a PDF. Look at the page instead, and state no length "
    "worked out from a printed scale."
)

TOOL_DESCRIPTION = (
    "Read and measure a page of a PDF drawing of this project (a floor plan, a section, a site plan plotted from "
    "CAD) from the file itself: its printed figures as text, its linework as geometry. Use it for what is printed "
    "on a sheet and for a width, a distance, a path or an area on it. Places are shares of the page as shown, 0 "
    "to 1, origin top left, as in look's `region`: look first to see where things are, then pass points.\n"
    "\n"
    "operation:\n"
    "  'sheet'       - size, format, whether it is a scan, each region's scale with its state, the unit convention. "
    "Start here once per page.\n"
    "  'figures'     - printed figures in `region` ([x, y, w, h]), filtered by `query` (a substring) or `kind` "
    "(dimension, level_mark, opening_size, scale_note, room_stamp, other).\n"
    "  'rooms'       - the room stamps: name, printed area and further lines, as printed.\n"
    "  'scale_check' - whether the page's own dimension figures corroborate the scale hinted for `region`.\n"
    "  'clearance'   - the clear width between two lines: `from` and `to` ([x, y]) placed NEAR the two faces. The "
    "engine moves each to the one line within reach; with two lines in reach it returns the crossings and no "
    "number, and you call again with `between`: [i, j].\n"
    "  'distance'    - between two points, each moved to the one line end or corner within reach.\n"
    "  'path', 'area' - along or inside `points` ([[x, y], ...]), each moved the same way.\n"
    "\n"
    "`threshold_min` / `threshold_max` (metres, or m² for an area): a value to compare with, which YOU pass from "
    "the requirement you looked up; the answer then says met, not_met or undecidable. A scale is verified (a "
    "person calibrated it), estimated (the file hints at it and the sheet's own figures agree) or uncalibrated. "
    "An estimated scale gives a length with a caveat and never a verdict; an uncalibrated one gives no number. "
    "'No number' and 'undecidable' are answers: report the reason and the remedy as given, and never work a "
    "length out yourself from a printed scale. State every number with its interval and provenance; never "
    "recompute, round or convert one. `document` is the PDF's file name; empty means the open document."
)


class DrawingMeasureInput(BaseModel):
    """What the model passes to ``drawing_measure``."""

    # A key the tool does not know is refused, not dropped: a misspelt `threshold_min` must not read as none.
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    operation: Operation = Field(description="What to read or measure; start with 'sheet'.")
    document: str = Field(default="", description="The PDF's file name; empty for the open document or the subject.")
    page: int = Field(default=1, ge=1, description="The page, starting at 1.")
    region: list[float] | None = Field(
        default=None, min_length=4, max_length=4, description="[x, y, w, h] in shares of the page, origin top left."
    )
    query: str = Field(default="", max_length=120, description="Text a figure must contain, for 'figures'.")
    kind: Kind | None = Field(default=None, description="The kind of figure to list, for 'figures'.")
    limit: int = Field(default=50, ge=1, le=200, description="Rows at most, for 'figures' and 'rooms'.")
    start: list[float] | None = Field(
        default=None, alias="from", min_length=2, max_length=2, description="[x, y]: the first point."
    )
    end: list[float] | None = Field(
        default=None, alias="to", min_length=2, max_length=2, description="[x, y]: the second point."
    )
    between: list[int] | None = Field(
        default=None, min_length=2, max_length=2, description="Two crossing indices a refused 'clearance' returned."
    )
    points: list[list[float]] = Field(
        default_factory=list, max_length=60, description="[[x, y], ...] for 'path' and 'area', in order."
    )
    threshold_min: float | None = Field(
        default=None, ge=0, allow_inf_nan=False, description="A minimum to compare with, in m or m²."
    )
    threshold_max: float | None = Field(
        default=None, ge=0, allow_inf_nan=False, description="A maximum to compare with, in m or m²."
    )


def _need_two(arguments: DrawingMeasureInput, page: int) -> NoNumber | None:
    if arguments.start is None or arguments.end is None:
        return NoNumber(f"'{arguments.operation}' needs two points", "pass `from` and `to` as [x, y]", page)
    return None


def measure(loaded: LoadedSheet, arguments: DrawingMeasureInput) -> Answer:
    """A measuring operation over a loaded sheet. Pure, so the tests drive it without a store."""
    # No crop is attached yet (the card of slice 6 carries it), so a threshold is decided only where a person
    # calibrated the region AND a printed figure on the span agrees with the measurement.
    request = Request(loaded.page, arguments.threshold_min, arguments.threshold_max, loaded.calibrations)
    sheet = loaded.sheet
    if arguments.operation in ("path", "area"):
        operation = sheet_measure.path if arguments.operation == "path" else sheet_measure.area
        return operation(sheet, arguments.points, request)
    missing = _need_two(arguments, loaded.page)
    if missing is not None:
        return missing
    if arguments.operation == "distance":
        return sheet_measure.distance(sheet, arguments.start, arguments.end, request)
    return sheet_measure.clearance(sheet, arguments.start, arguments.end, request, arguments.between)


def listing(loaded: LoadedSheet, arguments: DrawingMeasureInput) -> tuple[Listing, ...]:
    """A reading operation over a loaded sheet. Pure."""
    sheet = loaded.sheet
    if arguments.operation == "sheet":
        return (sheet_listing.overview(sheet, loaded.calibrations),)
    if arguments.operation == "figures":
        return (sheet_listing.figures(sheet, arguments.region, arguments.query, arguments.kind, arguments.limit),)
    if arguments.operation == "rooms":
        return (sheet_listing.rooms(sheet, arguments.limit),)
    return sheet_listing.scale_check(sheet, arguments.region)


def _listed(found: Listing) -> str:
    """A listing as text: this tool's words, then the sheet's own lines inside the fence quoted text sits in."""
    parts = ["\n".join(found.head)]
    if found.quoted:
        parts.append(fence("\n".join(found.quoted)))
    return "\n".join(parts)


def answer(loaded: LoadedSheet, arguments: DrawingMeasureInput) -> tuple[str, bool]:
    """The operation's text, and whether it answered (a number, or a listing) rather than refused."""
    head = f"File: {loaded.file_name}, page {loaded.page}"
    if loaded.calibrations_unread:
        head += (
            f"\n{loaded.calibrations_unread} stored calibration(s) of this page could not be read and were not used."
        )
    if arguments.operation in MEASURING:
        result = measure(loaded, arguments)
        return f"{head}\n{render(result)}", not isinstance(result, NoNumber)
    return "\n".join([head, *(_listed(found) for found in listing(loaded, arguments))]), True


async def _answered(arguments: DrawingMeasureInput) -> tuple[str, bool]:
    """The text the model reads and whether the call answered. Every refusal is a sentence, never a raise."""
    if not turn_states("pdf"):
        return NOT_ENABLED, False
    loaded = await load_sheet(arguments.document, arguments.page)
    if isinstance(loaded, str):
        return loaded, False
    try:
        text, answered = await asyncio.wait_for(asyncio.to_thread(answer, loaded, arguments), ANSWER_TIMEOUT_S)
    except TimeoutError:
        return (
            f"File: {loaded.file_name}, page {loaded.page}\nNo answer: the page is too dense for '"
            f"{arguments.operation}' to finish in time. Narrow `region`, or read the page with look.",
            False,
        )
    # The row names the file only once the model may be told it (listing is not use, ADR-0088), as look's does.
    if may_name(loaded.collection):
        record_lane_hit(loaded.file_name, detail=f"{arguments.operation} · p.{loaded.page}")
    return text, answered


async def run_drawing_measure(arguments: DrawingMeasureInput) -> str:
    """The tool body with its Herleitung row (ADR-0132): one row per call, settled on every path."""
    outcome = ActionOutcome()
    row = ActionRow("model", query=f"drawing {arguments.operation} p.{arguments.page}")
    try:
        text, answered = await _answered(arguments)
        outcome.failed = not answered
        outcome.settle(row)
        return text
    except BaseException:
        row.finish("error")
        raise


class DrawingMeasureConfig(FunctionBaseConfig, name="drawing_measure"):
    """Configuration for the ``drawing_measure`` tool. Nothing to set: the limits are the engine's own."""


@register_function(config_type=DrawingMeasureConfig)
async def drawing_measure(tool_config: DrawingMeasureConfig, builder: Builder):
    async def _drawing_measure(arguments: DrawingMeasureInput) -> str:
        """Read and measure a page of a PDF drawing of the project."""
        return await run_drawing_measure(arguments)

    yield FunctionInfo.from_fn(_drawing_measure, input_schema=DrawingMeasureInput, description=TOOL_DESCRIPTION)
