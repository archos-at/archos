from __future__ import annotations

import math

import pytest
from agent_testing.sheets import floor

from agent.drawings.sheet_calibration import MAX_CALIBRATIONS
from agent.drawings.sheet_calibration import from_record
from agent.drawings.sheet_calibration import from_records
from agent.drawings.sheet_scale import scale_at


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


def test_legacy_records_whose_regions_partly_overlap_read_and_the_smallest_then_newest_holds() -> None:
    _, sheet = floor()
    wide = _record(region={"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}, lengthM=6.0)
    same_size = _record(region={"x": 0.3, "y": 0.1, "w": 0.5, "h": 0.5}, **{"from": {"x": 0.4, "y": 0.3}}, lengthM=3.0)
    detail = _record(region={"x": 0.15, "y": 0.15, "w": 0.4, "h": 0.4}, lengthM=1.0)

    kept, skipped = from_records(sheet, [wide, same_size])
    shared = sheet.point((0.45, 0.3))

    assert skipped == 0
    assert scale_at(sheet, shared, kept).box == kept[1].box
    with_detail, _ = from_records(sheet, [detail, wide, same_size])
    assert scale_at(sheet, shared, with_detail).box == with_detail[0].box


def _whole_file(**changes: object) -> dict:
    return _record(
        scope="document",
        region={"x": 0, "y": 0, "w": 1, "h": 1},
        referenceSize={"widthPt": 1000.0, "heightPt": 500.0},
        **changes,
    )


def test_a_scale_for_the_whole_file_is_measured_on_the_page_it_was_set_on_and_holds_on_this_one() -> None:
    _, sheet = floor()

    calibration = from_record(sheet, _whole_file())

    distance = 0.3 * 1000.0
    assert calibration.base
    assert calibration.reference_length_pt == pytest.approx(distance)
    assert calibration.metres_per_point == pytest.approx(6.0 / distance)
    assert calibration.box == pytest.approx((0.0, 0.0, sheet.width_pt, sheet.height_pt))


def test_a_scale_for_the_whole_file_without_the_size_of_its_page_is_refused() -> None:
    _, sheet = floor()

    with pytest.raises((KeyError, TypeError, ValueError)):
        from_record(sheet, _whole_file(referenceSize={"widthPt": 0, "heightPt": 500.0}))
    with pytest.raises((KeyError, TypeError, ValueError)):
        from_record(sheet, {k: v for k, v in _whole_file().items() if k != "referenceSize"})


def test_a_pages_own_scale_wins_over_the_whole_file_even_over_the_same_whole_page() -> None:
    _, sheet = floor()
    whole_file = _whole_file(lengthM=6.0)
    own = _record(region={"x": 0, "y": 0, "w": 1, "h": 1}, lengthM=3.0)
    detail = _record(region={"x": 0.15, "y": 0.15, "w": 0.4, "h": 0.4}, lengthM=1.0)
    point = sheet.point((0.3, 0.3))

    kept, _ = from_records(sheet, [own, whole_file])
    assert scale_at(sheet, point, kept).metres_per_point == pytest.approx(kept[1].metres_per_point)
    assert not kept[1].base and kept[0].base
    assert "another calibration" not in scale_at(sheet, point, kept).contradiction

    kept, _ = from_records(sheet, [whole_file, detail])
    assert scale_at(sheet, point, kept).box == kept[1].box
    assert scale_at(sheet, sheet.point((0.9, 0.9)), kept).box == kept[0].box
