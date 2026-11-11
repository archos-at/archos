"""A person's calibration as the workspace stores it, turned into the engine's :class:`Calibration` for one sheet.

The workspace keeps what the person did: a region, two reference points (all
as shares of the page as shown) and the true length between them in metres. It
keeps no scale. The scale is computed here, from the sheet THIS process read:
a page size a client claimed is never part of a number.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_types import Sheet

#: The most calibrations of one page the engine takes; the workspace's read is bounded the same way.
MAX_CALIBRATIONS = 50


def _share(value: Any) -> float:
    number = float(value)
    if not (math.isfinite(number) and 0.0 <= number <= 1.000001):
        raise ValueError("a place is not a share of the page")
    return number


def _point(record: Mapping[str, Any]) -> tuple[float, float]:
    return _share(record["x"]), _share(record["y"])


def from_record(sheet: Sheet, record: Mapping[str, Any]) -> Calibration:
    """One stored calibration on ``sheet``. Raises ``ValueError`` (or ``KeyError``) for a record that is none."""
    region = record["region"]
    x, y = _point(region)
    width, height = _share(region["w"]), _share(region["h"])
    start, end = sheet.point(_point(record["from"])), sheet.point(_point(record["to"]))
    length_m = float(record["lengthM"])
    reference_pt = math.dist(start, end)
    if not (width > 0 and height > 0 and math.isfinite(length_m) and length_m > 0 and reference_pt > 0):
        raise ValueError("a calibration needs a region, two different points and a positive length")
    left, top = sheet.point((x, y))
    right, bottom = sheet.point((min(x + width, 1.0), min(y + height, 1.0)))
    return Calibration(
        box=(left, top, right, bottom),
        metres_per_point=length_m / reference_pt,
        reference_length_pt=reference_pt,
        label=f"a person's calibration ({length_m:.3f} m between two points)",
    )


def from_records(sheet: Sheet, records: Sequence[Any]) -> tuple[tuple[Calibration, ...], int]:
    """The calibrations among ``records`` and how many records were none, so a caller can say it skipped some."""
    kept: list[Calibration] = []
    skipped = 0
    for record in list(records)[:MAX_CALIBRATIONS]:
        try:
            kept.append(from_record(sheet, record))
        except KeyError, TypeError, ValueError:
            skipped += 1
    return tuple(kept), skipped
