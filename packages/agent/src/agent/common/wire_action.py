from __future__ import annotations

from typing import Annotated
from typing import Literal

from pydantic import Field

from agent.common.wire_model import WireModel

ActionVerb = Literal["search", "list", "read", "look", "lookup", "law", "web", "model", "workspace", "measure"]


class ActionCounts(WireModel):
    hits: int | None = Field(default=None, ge=0, description="Passages or matches returned.")
    documents: int | None = Field(default=None, ge=0, description="Distinct documents the hits are in.")
    searched: int | None = Field(default=None, ge=0, description="Documents searched, the denominator.")
    files: int | None = Field(default=None, ge=0, description="Files a listing showed.")
    folders: int | None = Field(default=None, ge=0, description="Folders a listing showed.")


PageShare = Annotated[float, Field(ge=0, le=1)]


class MeasuredShape(WireModel):
    quantity: Literal["clearance", "distance", "path", "area"]
    points: list[Annotated[list[PageShare], Field(min_length=2, max_length=2)]] = Field(
        min_length=2, max_length=60, description="[[x, y], ...] in shares of the page, the ends as snapped."
    )
    value: float = Field(ge=0, allow_inf_nan=False)
    unit: Literal["m", "m2"]
    basis: Literal["confirmed", "estimated", "printed"] = Field(
        description="A scale a person confirmed, a scale the sheet's own figures corroborate, or a printed figure."
    )
    ratio: float | None = Field(default=None, gt=0, description="The scale's N in 1:N, when the value is measured.")
