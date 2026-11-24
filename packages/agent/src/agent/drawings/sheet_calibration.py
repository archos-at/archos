from __future__ import annotations

import math
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_types import Sheet

MAX_CALIBRATIONS = 50


def _share(value: Any) -> float:
    number = float(value)
    if not (math.isfinite(number) and 0.0 <= number <= 1.000001):
        raise ValueError("a place is not a share of the page")
    return number


def _point(record: Mapping[str, Any]) -> tuple[float, float]:
    return _share(record["x"]), _share(record["y"])


def from_record(sheet: Sheet, record: Mapping[str, Any]) -> Calibration:
    region = record["region"]
    x, y = _point(region)
    width, height = _share(region["w"]), _share(region["h"])
    base = record.get("scope") == "document"
    start, end = _point(record["from"]), _point(record["to"])
    if base:
        size = record["referenceSize"]
        wide, high = float(size["widthPt"]), float(size["heightPt"])
        if not (math.isfinite(wide) and math.isfinite(high) and wide > 0 and high > 0):
            raise ValueError("a scale for every page needs the size of the page it was measured on")
    else:
        wide, high = sheet.width_pt, sheet.height_pt
    length_m = float(record["lengthM"])
    reference_pt = math.hypot((end[0] - start[0]) * wide, (end[1] - start[1]) * high)
    if not (width > 0 and height > 0 and math.isfinite(length_m) and length_m > 0 and reference_pt > 0):
        raise ValueError("a calibration needs a region, two different points and a positive length")
    left, top = sheet.point((x, y))
    right, bottom = sheet.point((min(x + width, 1.0), min(y + height, 1.0)))
    return Calibration(
        box=(left, top, right, bottom),
        metres_per_point=length_m / reference_pt,
        reference_length_pt=reference_pt,
        label=f"a person's calibration ({length_m:.3f} m between two points)",
        base=base,
    )


def _after_whole_file(record: Any) -> bool:
    return not (isinstance(record, Mapping) and record.get("scope") == "document")


def from_records(sheet: Sheet, records: Sequence[Any]) -> tuple[tuple[Calibration, ...], int]:
    kept: list[Calibration] = []
    skipped = 0
    ordered = sorted(records, key=_after_whole_file)
    for record in ordered[:MAX_CALIBRATIONS]:
        try:
            kept.append(from_record(sheet, record))
        except KeyError, TypeError, ValueError:
            skipped += 1
    return tuple(kept), skipped
