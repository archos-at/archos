"""A person's tape on a sheet: the engine's answer as data, for the review view (ADR-0182, slice 8).

``drawing_measure`` answers a model in text. The review view draws a
measurement beside the shape a person clicked, so it needs the same answer as
fields. Both come from ONE call of the engine: :func:`measured` runs
``measure_register.measure`` with the arguments the tool would be given for
the same points and turns the :class:`Answer` into a mapping, where the tool
renders the same object (``sheet_answers.render``). Nothing is computed twice,
so the value, the interval and the provenance cannot differ between the two.

``snap`` is the engine's own snapping (``sheet_probe.snap``) for each point,
without a measurement: where the point lands, or why it lands nowhere.

The gate is the tool's: a call the BFF stated no ``pdf`` for is refused
(``turn_file_kinds.turn_states``). The BFF names the file and its collection
(it holds the document row), and the bytes are still found through its scoped
lookup under the echoed envelope (``sheet_source``), never by this module.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from collections.abc import Sequence
from typing import Annotated
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common.turn_file_kinds import turn_states
from agent.drawings import sheet_probe
from agent.drawings.sheet_answers import Answer
from agent.drawings.sheet_answers import Measurement

from ..look.resolve import Resolved
from .measure_register import ANSWER_TIMEOUT_S
from .measure_register import DrawingMeasureInput
from .measure_register import measure
from .sheet_source import LoadedSheet
from .sheet_source import load_resolved_sheet

TapeOperation = Literal["distance", "path", "area", "snap"]
#: As many points as the tool takes (``DrawingMeasureInput.points``).
MAX_POINTS = 60
#: A share of the page as shown, origin top left.
Share = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class TapeRequest(BaseModel):
    """What the BFF asks for a person: a file it named, a page, and points as shares of the page."""

    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1, max_length=1024)
    collection: str = Field(min_length=1, max_length=256)
    page: int = Field(default=1, ge=1)
    operation: TapeOperation
    points: list[tuple[Share, Share]] = Field(min_length=1, max_length=MAX_POINTS)


def _pairs(points: Iterable[Sequence[float]]) -> list[list[float]]:
    return [[float(point[0]), float(point[1])] for point in points]


def _measurement(answer: Measurement) -> dict[str, Any]:
    low, high = answer.interval
    outcome = answer.outcome
    return {
        "quantity": answer.quantity,
        "value": answer.value,
        "unit": answer.unit,
        "low": low,
        "high": high,
        "provenance": answer.provenance,
        "scaleState": answer.scale.state,
        "scaleRatio": answer.scale.ratio,
        "verdict": outcome.verdict if outcome is not None else None,
        "reasons": list(outcome.reasons) if outcome is not None else [],
        "points": _pairs(answer.points),
    }


def _no_number(reason: str, remedy: str, scale_state: str | None = None, candidates: Iterable = ()) -> dict[str, Any]:
    return {
        "noNumber": {"reason": reason, "remedy": remedy, "scaleState": scale_state, "candidates": _pairs(candidates)}
    }


def structured(answer: Answer) -> dict[str, Any]:
    """An engine answer as data: every field a fact of the answer, none added. Pure."""
    if isinstance(answer, Measurement):
        return {"measurement": _measurement(answer)}
    state = answer.scale.state if answer.scale is not None else None
    return _no_number(answer.reason, answer.remedy, state, answer.candidates)


def arguments_of(request: TapeRequest) -> DrawingMeasureInput:
    """The tool's own arguments for these points, so the tape and the tool ask the engine one question."""
    points = _pairs(request.points)
    if request.operation == "distance":
        return DrawingMeasureInput.model_validate(
            {"operation": "distance", "page": request.page, "from": points[0], "to": points[-1]}
        )
    return DrawingMeasureInput(operation=request.operation, page=request.page, points=points)


def measured(loaded: LoadedSheet, request: TapeRequest) -> dict[str, Any]:
    """A measuring operation over a loaded sheet, as data. Pure."""
    if request.operation == "distance" and len(request.points) != 2:
        return _no_number("a distance needs two points", "pass exactly two")
    return structured(measure(loaded, arguments_of(request)))


def _snap_of(loaded: LoadedSheet, share: Sequence[float]) -> dict[str, Any]:
    sheet = loaded.sheet
    found = sheet_probe.snap(sheet, sheet.point(share))
    if isinstance(found, sheet_probe.Snapped):
        return {
            "snapped": list(sheet.share(found.point)),
            "movedPt": found.moved,
            "reason": None,
            "detail": None,
            "candidates": [],
        }
    candidates = _pairs(sheet.share(place) for place in found.candidates[:MAX_POINTS])
    return {
        "snapped": None,
        "movedPt": None,
        "reason": "several" if candidates else "none",
        "detail": found.reason,
        "candidates": candidates,
    }


def snapped(loaded: LoadedSheet, request: TapeRequest) -> dict[str, Any]:
    """Where the engine ties each point to linework, or why it ties it nowhere. Pure."""
    return {"snap": [_snap_of(loaded, share) for share in request.points]}


async def run_tape(request: TapeRequest) -> dict[str, Any]:
    """The answer for one request of the review view. A refusal is data too, never a raise."""
    if not turn_states("pdf"):
        return {"refused": "not_enabled"}
    loaded = await load_resolved_sheet(Resolved(request.file_name, request.collection), request.page)
    if isinstance(loaded, str):
        return _no_number(loaded, "")
    work = snapped if request.operation == "snap" else measured
    try:
        return await asyncio.wait_for(asyncio.to_thread(work, loaded, request), ANSWER_TIMEOUT_S)
    except TimeoutError:
        return _no_number("the page is too dense to answer in time", "zoom in and place the points on clear corners")
