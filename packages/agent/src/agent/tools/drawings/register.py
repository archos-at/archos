"""``dxf_measure`` — a project's DXF drawing as a site the agent can ask about (ADR-0153).

The PDF rendition (ADR-0152) lets the agent READ a DXF: its labels and the
parcel list are text in the index. This tool lets it MEASURE one: parcel areas
and shapes, the boundary shared with each neighbour, the buildings on a parcel
and their distance to each boundary, what remains buildable after given
setbacks and limits, the distance between two parcels or buildings, and, for any
DXF, its labels and what its layers hold. The numbers come from the drawing's
own geometry (``agent.drawings``), the same model the rendition draws, so the
page a person sees and the figures the agent quotes cannot disagree.

Served twice like ``ifc_measure``: as the agent's native tool, and on the MCP door
as ``dxf-measure`` for other agents (``apps/workspace/bff/agent-api/backend-operations.ts``).
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel
from pydantic import Field

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from agent.common.turn_status import record_lane_hit
from agent.drawings import site_ops
from agent.drawings import site_reading
from agent.drawings.site import Site
from agent.drawings.site_ops import SiteAnswer
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from .source import LoadedSite
from .source import load_site

logger = logging.getLogger(__name__)

Operation = Literal["overview", "parcels", "parcel", "setbacks", "buildable", "distance", "texts", "layers"]

TOOL_DESCRIPTION = (
    "Measure a DXF drawing of this project, above all a Katasterauszug (BEV Katastralmappe): the site as geometry, "
    "not as a picture. Use it for questions about parcels and what stands on them: a parcel's area and shape, which "
    "parcels border it and along how much boundary, the buildings on it with their footprint and coverage, how far "
    "each building stands from each boundary, what remains buildable after setbacks you give, and what a coverage or "
    "density limit allows. For any other DXF it finds labels and says what each layer holds.\n"
    "\n"
    "operation:\n"
    "  'overview'  — what the drawing is (Katastralmappe or not, KG, coordinate system, unit), how many parcels and "
    "buildings, its layers. Start here once per file.\n"
    "  'parcels'   — every parcel as a row (KG, cadastre, area, built-up area and coverage, neighbours); `parcels` "
    "names some.\n"
    "  'parcel'    — one parcel (`parcel`): area, perimeter, enclosing rectangle, boundary length per neighbour and "
    "to the edge of the extract, the buildings on it.\n"
    "  'setbacks'  — for each building on the parcel, its shortest distance to each neighbour's boundary.\n"
    "  'buildable' — the parcel minus a band along each boundary: `setback_m` for every side, `setbacks` "
    "({neighbour parcel: metres}) per side; `coverage_limit` (0.4 or 40 for 40 %) and `density_limit` (a "
    "floor-area ratio such as 1.2) as allowances. The values are the ones YOU pass, from the Bebauungsplan or the "
    "building code (look them up first); the drawing holds none.\n"
    "  'distance'  — the shortest distance between two things in `between`: parcel numbers or 'building N'.\n"
    "  'texts'     — labels containing `query`, with their layer, position and parcel.\n"
    "  'layers'    — what each layer holds: entity kinds, line length, closed outlines and their area.\n"
    "\n"
    "`document` is the file name as the inventory lists it; empty means the document open on the canvas or the "
    "conversation's subject. Name parcels as the drawing does ('123/4', '.57'). Every answer says how far it can be "
    "trusted: Grundsteuerkataster boundaries are graphic and not legally binding, so quote that caveat with the "
    "number. 'Undecidable' is an answer about the file: report what is missing and the remedy. Never recompute, round "
    "or convert a returned number."
)


class DxfMeasureInput(BaseModel):
    """What the model passes to ``dxf_measure``."""

    operation: Operation = Field(description="What to measure; start with 'overview'.")
    document: str = Field(default="", description="The DXF's file name; empty for the open document or the subject.")
    parcel: str = Field(default="", description="One parcel number, for 'parcel', 'setbacks' and 'buildable'.")
    parcels: list[str] = Field(default_factory=list, description="Parcel numbers to list with 'parcels'.")
    between: list[str] = Field(default_factory=list, description="Two parcel numbers or 'building N', for 'distance'.")
    setback_m: float | None = Field(default=None, ge=0, le=100, description="Setback on every side, metres.")
    setbacks: dict[str, float] = Field(
        default_factory=dict, description="Setback per neighbouring parcel number, metres; overrides setback_m there."
    )
    coverage_limit: float | None = Field(default=None, gt=0, le=100, description="Maximum coverage: 0.4 or 40 (%).")
    density_limit: float | None = Field(default=None, gt=0, le=20, description="Maximum floor-area ratio, e.g. 1.2.")
    query: str = Field(default="", description="Text to find with 'texts'; empty lists every label.")
    building_layers: list[str] = Field(
        default_factory=list, description="Layers holding building outlines, for a DXF that is not a cadastral map."
    )
    limit: int = Field(default=50, ge=1, le=500, description="Rows at most, for 'parcels', 'texts' and 'layers'.")


def answer(site: Site, arguments: DxfMeasureInput) -> SiteAnswer:
    """The operation over a loaded site. Pure, so the tests drive it without a store."""
    operation = arguments.operation
    if operation == "overview":
        return site_ops.overview(site)
    if operation == "parcels":
        return site_ops.parcels(site, arguments.parcels or None, arguments.limit)
    if operation == "parcel":
        return site_ops.parcel(site, arguments.parcel)
    if operation == "setbacks":
        return site_ops.setbacks(site, arguments.parcel)
    if operation == "buildable":
        return site_ops.buildable(
            site,
            arguments.parcel,
            setback_m=arguments.setback_m,
            setbacks_by_neighbour=arguments.setbacks,
            coverage_limit=arguments.coverage_limit,
            density_limit=arguments.density_limit,
        )
    if operation == "distance":
        if len(arguments.between) != 2:
            return site_ops.undecidable(
                "'distance' needs two things.", "pass `between` with two parcel numbers or 'building N'."
            )
        return site_ops.distance(site, arguments.between[0], arguments.between[1])
    if operation == "texts":
        return site_reading.texts(site, arguments.query, arguments.limit)
    return site_reading.layers(site, arguments.limit)


def _rendered(loaded: LoadedSite, result: SiteAnswer) -> str:
    return f"File: {loaded.file_name}\n{result.text()}"


async def run_dxf_measure(arguments: DxfMeasureInput) -> str:
    """The tool body with its Herleitung row (ADR-0132): one row per call, settled on every path."""
    outcome = ActionOutcome()
    row = ActionRow("model", query=f"dxf {arguments.operation} {arguments.parcel or arguments.query}".strip())
    try:
        loaded = await load_site(arguments.document, tuple(arguments.building_layers))
        if isinstance(loaded, str):
            outcome.failed = True
            outcome.settle(row)
            return loaded
        result = answer(loaded.site, arguments)
        # The Herleitung hangs the file this call read on its round, the way a look or a model query is filed.
        record_lane_hit(loaded.file_name, detail=" · ".join(filter(None, (arguments.operation, arguments.parcel))))
        outcome.failed = not result.decidable
        outcome.settle(row)
        return _rendered(loaded, result)
    except BaseException:
        row.finish("error")
        raise


class DxfMeasureConfig(FunctionBaseConfig, name="dxf_measure"):
    """Configuration for the ``dxf_measure`` tool. Nothing to set: the limits are the operations' own."""


@register_function(config_type=DxfMeasureConfig)
async def dxf_measure(tool_config: DxfMeasureConfig, builder: Builder):
    async def _dxf_measure(arguments: DxfMeasureInput) -> str:
        """Measure a DXF drawing of the project as a site."""
        return await run_dxf_measure(arguments)

    yield FunctionInfo.from_fn(_dxf_measure, input_schema=DxfMeasureInput, description=TOOL_DESCRIPTION)
