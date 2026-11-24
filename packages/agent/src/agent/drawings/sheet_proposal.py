from __future__ import annotations

import json
import math
from dataclasses import dataclass

from agent.drawings.sheet_scale import FigureCheck
from agent.drawings.sheet_scale import Hint
from agent.drawings.sheet_scale import ScaleReading
from agent.drawings.sheet_scale import contains
from agent.drawings.sheet_scale import corroborate
from agent.drawings.sheet_types import Box
from agent.drawings.sheet_types import Sheet
from agent.drawings.sheet_types import inert

SET_OPERATION = "drawing-calibration-set"
EDGE_MARGIN_PT = 0.5


@dataclass(frozen=True)
class CalibrationProposal:
    page: int
    region: tuple[float, float, float, float]
    start: tuple[float, float]
    end: tuple[float, float]
    length_m: float
    printed: str
    agreeing: int
    total: int

    def body(self) -> dict[str, object]:
        x, y, w, h = self.region
        return {
            "page": self.page,
            "region": {"x": x, "y": y, "w": w, "h": h},
            "from": {"x": self.start[0], "y": self.start[1]},
            "to": {"x": self.end[0], "y": self.end[1]},
            "lengthM": self.length_m,
        }


def _on_page(sheet: Sheet, box: Box) -> Box:
    return (max(box[0], 0.0), max(box[1], 0.0), min(box[2], sheet.width_pt), min(box[3], sheet.height_pt))


def _well_inside(box: Box, check: FigureCheck) -> bool:
    inner = (box[0] + EDGE_MARGIN_PT, box[1] + EDGE_MARGIN_PT, box[2] - EDGE_MARGIN_PT, box[3] - EDGE_MARGIN_PT)
    return all(contains(inner, end) for end in check.ends)


def proposal_for(sheet: Sheet, scale: ScaleReading | None, page: int) -> CalibrationProposal | None:
    if scale is None or scale.state != "estimated" or scale.metres_per_point is None:
        return None
    if scale.source != "stored_region":
        return None
    found = corroborate(sheet, Hint(scale.source, scale.metres_per_point, scale.box, 0.0, scale.label))
    if not found.corroborated:
        return None
    box = _on_page(sheet, scale.box)
    usable = [check for check in found.checks if check.agrees and _well_inside(box, check)]
    if not usable:
        return None
    reference = max(usable, key=lambda check: (round(check.span_pt, 3), check.ends))
    start, end = sorted(reference.ends)
    if not (math.isfinite(reference.metres) and reference.metres > 0):
        return None
    return CalibrationProposal(
        page=page,
        region=sheet.share_box(box),
        start=sheet.share(start),
        end=sheet.share(end),
        length_m=round(reference.metres, 4),
        printed=inert(reference.figure.text, 24),
        agreeing=found.agreeing,
        total=len(found.checks),
    )


def proposal_lines(proposal: CalibrationProposal, document_id: str) -> list[str]:
    call = json.dumps({"params": {"id": document_id}, "body": proposal.body()}, separators=(",", ":"))
    return [
        "To have a person confirm this scale, propose a calibration (a card they accept or dismiss; nothing "
        f"is written before): workspace__call operation '{SET_OPERATION}' with input {call}",
        f"The reference is the printed dimension {proposal.printed} ({proposal.length_m:g} m) between its two "
        f"ends; {proposal.agreeing} of {proposal.total} dimension figures agree with the estimated scale. Pass "
        "the input as given; do not change a place or the length. Until the person accepts, the scale stays "
        "estimated and no threshold is decided.",
    ]
