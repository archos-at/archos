"""A stored calibration becomes the engine's, with its scale computed from the sheet this process read."""

from __future__ import annotations

import math

import pytest
from agent_testing.sheets import floor

from agent.drawings.sheet_calibration import MAX_CALIBRATIONS
from agent.drawings.sheet_calibration import from_record
from agent.drawings.sheet_calibration import from_records


def _record(**changes: object) -> dict:
    record = {
        "region": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5},
        "from": {"x": 0.2, "y": 0.3},
        "to": {"x": 0.5, "y": 0.3},
        "lengthM": 6.0,
    }
    return {**record, **changes}


def test_the_scale_is_the_length_over_the_distance_on_the_sheet_as_read() -> None:
    _, sheet = floor()

    calibration = from_record(sheet, _record())

    distance = 0.3 * sheet.width_pt
    assert calibration.reference_length_pt == pytest.approx(distance)
    assert calibration.metres_per_point == pytest.approx(6.0 / distance)
    assert calibration.box == pytest.approx(
        (0.1 * sheet.width_pt, 0.1 * sheet.height_pt, 0.6 * sheet.width_pt, 0.6 * sheet.height_pt)
    )
    assert calibration.relative_error == pytest.approx(1 / distance)


@pytest.mark.parametrize(
    "changes",
    [
        {"lengthM": 0},
        {"lengthM": -1},
        {"lengthM": math.inf},
        {"lengthM": "long"},
        {"to": {"x": 0.2, "y": 0.3}},
        {"from": {"x": 1.4, "y": 0.3}},
        {"from": {"x": math.nan, "y": 0.3}},
        {"region": {"x": 0.1, "y": 0.1, "w": 0, "h": 0.5}},
        {"region": None},
    ],
)
def test_a_record_that_is_no_calibration_is_refused(changes: dict) -> None:
    _, sheet = floor()

    with pytest.raises((KeyError, TypeError, ValueError)):
        from_record(sheet, _record(**changes))


def test_records_are_bounded_and_the_unreadable_ones_counted() -> None:
    _, sheet = floor()

    kept, skipped = from_records(sheet, [_record(), {"nothing": 1}, 7, *[_record()] * 100])

    assert len(kept) == MAX_CALIBRATIONS - 2 and skipped == 2
