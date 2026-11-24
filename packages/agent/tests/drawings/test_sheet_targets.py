from __future__ import annotations

import math

import pytest
from agent_testing.sheets import floor

from agent.drawings import sheet_probe
from agent.drawings import sheet_targets
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_types import Segment
from agent.drawings.sheet_types import SegmentTable
from agent.drawings.sheet_types import Sheet


def _pairs(flat: tuple[float, ...]) -> list[tuple[float, float]]:
    return list(zip(flat[0::2], flat[1::2], strict=True))


def _bare(*segments: tuple[float, float, float, float]) -> Sheet:
    table = SegmentTable.of([Segment(*ends, 0.5, False, False, 0) for ends in segments])
    return Sheet(1000.0, 500.0, 352.8, 176.4, None, 0, 1.0, table, (), (), False)


@pytest.mark.parametrize("options", [{}, {"rotate": 90}, {"rotate": 270, "cropped": True}])
def test_the_rooms_corners_are_targets_in_the_frame_the_tape_measures_in(options) -> None:
    drawn, sheet = floor(**options)

    vertices = _pairs(sheet_targets.linework(sheet).vertices)

    for corner in [(0, 0), (drawn.WIDTH_M, 0), (drawn.WIDTH_M, drawn.DEPTH_M), (0, drawn.DEPTH_M), (4.0, 3.0)]:
        share = drawn.share(*corner)
        assert min(math.dist(share, vertex) for vertex in vertices) < 2e-5, corner


def test_a_vertex_the_browser_snaps_to_is_where_the_engine_snaps_too() -> None:
    drawn, sheet = floor()

    for corner in [(0, 0), (4.0, 0), (4.0, 3.0), (drawn.WIDTH_M, drawn.DEPTH_M)]:
        vertex = min(_pairs(sheet_targets.linework(sheet).vertices), key=lambda v: math.dist(v, drawn.share(*corner)))
        found = sheet_probe.snap(sheet, sheet.point(vertex))

        assert isinstance(found, sheet_probe.Snapped), corner
        assert sheet.share(found.point) == pytest.approx(vertex, abs=2e-5)


def test_two_lines_that_cross_give_their_crossing_and_a_twice_drawn_line_is_one_line() -> None:
    sheet = _bare((100, 100, 300, 100), (200, 50, 200, 150), (100, 100, 300, 100.1), (0, 0, 0.2, 0))

    found = sheet_targets.linework(sheet)

    assert (0.2, 0.2) in _pairs(found.vertices)
    assert len(found.segments) == 2 * 4 and not found.truncated
    assert found.total_segments == 4


def test_a_dense_page_keeps_its_longest_lines_and_says_it_was_cut(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sheet_targets, "MAX_SEGMENTS", 1)
    sheet = _bare((0, 0, 10, 0), (0, 200, 900, 200), (0, 400, 20, 400))

    found = sheet_targets.linework(sheet)

    assert found.truncated and found.segments == (0.0, 0.4, 0.9, 0.4)


def test_the_targets_are_read_once_per_sheet() -> None:
    _, sheet = floor()

    assert sheet_targets.linework(sheet) is sheet_targets.linework(sheet)


def test_the_stored_region_is_an_estimated_scale_in_metres_per_share_of_the_page() -> None:
    drawn, sheet = floor()

    (scale,) = sheet_targets.scales(sheet)

    assert scale["state"] == "estimated" and scale["source"] == "stored_region"
    assert scale["metresPerShare"] == pytest.approx(
        [drawn.true_metres_per_point * sheet.width_pt, drawn.true_metres_per_point * sheet.height_pt]
    )
    assert scale["ratio"] == pytest.approx(100.0, abs=0.01)
    assert len(scale["region"]) == 4


def test_a_calibration_is_listed_first_as_verified_and_a_page_without_scale_has_an_unscaled_entry() -> None:
    _, sheet = floor(stored_region=False, scale_note=False)
    calibration = Calibration((0.0, 0.0, 100.0, 100.0), 0.02, 200.0)

    first, page = sheet_targets.scales(sheet, [calibration])

    assert first["state"] == "verified" and first["metresPerShare"] == pytest.approx(
        [0.02 * sheet.width_pt, 0.02 * sheet.height_pt]
    )
    assert page == {"region": None, "state": "uncalibrated", "source": "none", "metresPerShare": None, "ratio": None}
