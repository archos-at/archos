from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common.turn_file_kinds import turn_states
from agent.drawings import sheet_targets

from ..look.resolve import Resolved
from .measure_register import ANSWER_TIMEOUT_S
from .sheet_source import LoadedSheet
from .sheet_source import load_resolved_sheet


class SnapTargetsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1, max_length=1024)
    collection: str = Field(min_length=1, max_length=256)
    page: int = Field(default=1, ge=1)


def targets_of(loaded: LoadedSheet) -> dict[str, Any]:
    sheet = loaded.sheet
    found = sheet_targets.linework(sheet)
    return {
        "targets": {
            "documentId": loaded.document_id,
            "versionId": loaded.version_id,
            "page": loaded.page,
            "widthPt": sheet.width_pt,
            "heightPt": sheet.height_pt,
            "widthMm": sheet.width_mm,
            "heightMm": sheet.height_mm,
            "rotation": sheet.rotation,
            "scan": sheet.scan,
            "vertices": list(found.vertices),
            "segments": list(found.segments),
            "totalSegments": found.total_segments,
            "truncated": found.truncated,
            "scales": sheet_targets.scales(sheet, loaded.calibrations),
        }
    }


async def run_snap_targets(request: SnapTargetsRequest) -> dict[str, Any]:
    if not turn_states("pdf"):
        return {"refused": "not_enabled"}
    loaded = await load_resolved_sheet(Resolved(request.file_name, request.collection), request.page)
    if isinstance(loaded, str):
        return {"unavailable": {"reason": loaded}}
    try:
        return await asyncio.wait_for(asyncio.to_thread(targets_of, loaded), ANSWER_TIMEOUT_S)
    except TimeoutError:
        return {"unavailable": {"reason": "the page is too dense to list its line ends in time"}}
