"""Measuring on a sheet: the engine picks the span, the scale decides whether there is a number, and only a
person's uncontradicted calibration decides a threshold.

The floor is drawn at known dimensions: the corridor between y = 3.00 and y = 4.20 is 1.20 m clear, the room
left of x = 4.00 is 4.00 by 3.00 m.
"""

from __future__ import annotations

import random
from dataclasses import replace

import pytest
from agent_testing.sheets import floor
from agent_testing.sheets import sheet_of
from knowledge_layer_testing.sheet_fixtures import SheetPage

from agent.drawings import sheet_measure
from agent.drawings import sheet_probe
from agent.drawings.sheet_answers import Measurement
from agent.drawings.sheet_answers import NoNumber
from agent.drawings.sheet_answers import render
from agent.drawings.sheet_measure import Request
from agent.drawings.sheet_scale import Calibration


def _calibrated(drawn, sheet, factor: float = 1.0) -> list[Calibration]:
    return [Calibration(sheet.regions[0].box, drawn.true_metres_per_point * factor, 283.0, "calibration by A.")]


def _corridor(drawn, sheet, request: Request, x: float = 5.0):
    return sheet_measure.clearance(sheet, drawn.share(x, 3.1), drawn.share(x, 4.1), request)


class TestClearance:
    def test_on_an_estimated_scale_it_is_a_length_with_its_caveat_and_never_a_verdict(self):
        drawn, sheet = floor()

        answer = _corridor(drawn, sheet, Request(threshold_min=1.0, crop_attached=True))

        assert isinstance(answer, Measurement) and answer.provenance == "vector_estimated"
        assert answer.value == pytest.approx(1.2, abs=1e-4)
        assert answer.outcome.verdict == "undecidable"
        assert any("the scale is estimated, not verified by a person" in reason for reason in answer.outcome.reasons)

    def test_the_interval_is_the_stroke_at_scale_or_the_scales_error_whichever_is_larger(self):
        drawn, sheet = floor()

        answer = _corridor(drawn, sheet, Request())

        # The walls are 0.5 pt strokes: 1.76 cm at 1:100, more than 0.1 % of 1.20 m.
        assert answer.interval == pytest.approx((1.2 - 0.5 * 0.0352778, 1.2 + 0.5 * 0.0352778), abs=1e-4)
        assert answer.outcome is None

    @pytest.mark.parametrize("options", [{}, {"rotate": 90, "cropped": True}, {"view_angle": 20.0}, {"scale": 50}])
    def test_ends_placed_askew_still_measure_the_drawn_width(self, options):
        """Two hundred probes, each end jittered along and across the corridor by a seeded generator."""
        drawn, sheet = floor(**options)
        rng = random.Random(20261111)
        per_metre = 1 / drawn.true_metres_per_point
        for _ in range(200):
            across = [rng.uniform(-3.0, 3.0) / per_metre for _ in range(2)]
            along = [rng.uniform(-4.0, 4.0) / per_metre for _ in range(2)]
            start = drawn.share(5.0 + across[0], 3.0 + along[0])
            end = drawn.share(5.0 + across[1], 4.2 + along[1])

            answer = sheet_measure.clearance(sheet, start, end, Request())

            assert isinstance(answer, Measurement), render(answer)
            assert answer.interval[0] <= 1.2 <= answer.interval[1]
            assert answer.value == pytest.approx(1.2, abs=1e-3)

    def test_an_end_with_two_lines_in_reach_returns_the_crossings_and_no_number(self):
        drawn, sheet = floor()

        answer = sheet_measure.clearance(sheet, drawn.share(4.6, 2.5), drawn.share(9.95, 2.5), Request())

        assert isinstance(answer, NoNumber) and "2 lines within reach of it" in answer.reason
        assert [row.index for row in answer.crossings] == [0, 1, 2]
        assert answer.crossings[1].place == pytest.approx(drawn.share(9.9, 2.5), abs=2e-5)
        assert "No number" in render(answer) and "crossing 2:" in render(answer)

    def test_between_names_two_of_the_crossings_returned(self):
        drawn, sheet = floor()

        inner = sheet_measure.clearance(sheet, drawn.share(4.6, 2.5), drawn.share(9.95, 2.5), Request(), between=[0, 1])
        outer = sheet_measure.clearance(sheet, drawn.share(4.6, 2.5), drawn.share(9.95, 2.5), Request(), between=[0, 2])

        assert inner.value == pytest.approx(5.4, abs=1e-3) and inner.inside == 0
        assert outer.value == pytest.approx(5.5, abs=1e-3) and outer.inside == 1

    def test_between_that_names_no_crossing_is_refused(self):
        drawn, sheet = floor()

        answer = sheet_measure.clearance(
            sheet, drawn.share(4.6, 2.5), drawn.share(9.95, 2.5), Request(), between=[0, 9]
        )

        assert isinstance(answer, NoNumber) and "two different crossings of the 3 listed" in answer.reason

    def test_an_end_with_no_line_in_reach_returns_no_number(self):
        drawn, sheet = floor()

        answer = sheet_measure.clearance(sheet, drawn.share(5.0, 3.1), drawn.share(5.0, 3.6), Request())

        assert isinstance(answer, NoNumber) and "no linework within reach of the second point" in answer.reason

    def test_lines_that_are_not_parallel_are_measured_along_the_probe_and_decide_nothing(self):
        page = SheetPage()
        page.line(100, 100, 100, 400)
        page.line(200, 100, 230, 400)
        sheet = sheet_of(page)
        whole = [Calibration((0.0, 0.0, sheet.width_pt, sheet.height_pt), 0.01, 300.0)]
        request = Request(threshold_min=0.5, calibrations=whole, crop_attached=True)

        answer = sheet_measure.clearance(sheet, sheet.share((103, 600)), sheet.share((213, 600)), request)

        assert answer.outcome.verdict == "undecidable"
        assert any("not parallel (5.7 degrees apart)" in reason for reason in answer.outcome.reasons)

    def test_a_point_off_the_page_is_refused(self):
        drawn, sheet = floor()

        assert isinstance(sheet_measure.clearance(sheet, (1.2, 0.5), (0.5, 0.5), Request()), NoNumber)


class TestAVerdict:
    def test_met_needs_a_calibration_a_clear_span_and_the_crop(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet), crop_attached=True)

        answer = _corridor(drawn, sheet, request)

        assert answer.provenance == "vector_verified" and answer.outcome.verdict == "met"
        assert answer.outcome.reasons == ()

    def test_not_met(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.5, calibrations=_calibrated(drawn, sheet), crop_attached=True)

        assert _corridor(drawn, sheet, request).outcome.verdict == "not_met"

    def test_a_maximum_is_decided_the_same_way(self):
        drawn, sheet = floor()
        base = {"calibrations": _calibrated(drawn, sheet), "crop_attached": True}

        assert _corridor(drawn, sheet, Request(threshold_max=1.5, **base)).outcome.verdict == "met"
        assert _corridor(drawn, sheet, Request(threshold_max=1.0, **base)).outcome.verdict == "not_met"

    def test_without_an_agreeing_figure_or_a_crop_it_is_undecidable(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet))

        answer = _corridor(drawn, sheet, request)

        assert answer.outcome.verdict == "undecidable"
        assert answer.outcome.reasons == (
            "no printed figure on the span agrees and the answer carries no crop for a person to check",
        )

    def test_a_printed_figure_on_the_span_that_agrees_stands_in_for_the_crop(self):
        """Measured along the dimension line of the 1,20 itself."""
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet))

        answer = sheet_measure.clearance(sheet, drawn.share(-0.9, 3.05), drawn.share(-0.9, 4.15), request)

        assert answer.value == pytest.approx(1.2, abs=1e-3)
        assert (answer.printed.text, answer.printed.agrees) == ("1,20", True)
        assert answer.outcome.verdict == "met"

    def test_a_printed_figure_that_disagrees_makes_it_undecidable_even_with_the_crop(self):
        drawn, sheet = floor(stored_region=False, replot=0.9)
        whole = [Calibration((0.0, 0.0, sheet.width_pt, sheet.height_pt), drawn.true_metres_per_point * 1.2, 283.0)]
        request = Request(threshold_min=1.0, calibrations=whole, crop_attached=True)

        answer = sheet_measure.clearance(sheet, drawn.share(-0.9, 3.05), drawn.share(-0.9, 4.15), request)

        assert answer.printed.agrees is False and answer.outcome.verdict == "undecidable"
        assert any("disagrees with the measurement" in reason for reason in answer.outcome.reasons)

    def test_a_line_inside_the_span_makes_it_undecidable(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet), crop_attached=True)

        answer = sheet_measure.clearance(sheet, drawn.share(0.05, 1.5), drawn.share(4.45, 1.5), request)

        assert answer.value == pytest.approx(4.5, abs=1e-3) and answer.inside == 1
        assert answer.outcome.verdict == "undecidable"
        assert answer.outcome.reasons == ("1 lines cross the span between its ends",)

    def test_a_contradicted_calibration_decides_nothing_in_its_region(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet, 1.05), crop_attached=True)

        answer = _corridor(drawn, sheet, request)

        assert answer.provenance == "vector_verified" and answer.outcome.verdict == "undecidable"
        assert any("the calibration is contradicted" in reason for reason in answer.outcome.reasons)
        assert "CONTRADICTED" in render(answer)

    @pytest.mark.parametrize("threshold", [1.19, 1.2, 1.215])
    def test_a_threshold_within_two_centimetres_of_the_value_is_undecidable(self, threshold):
        drawn, sheet = floor()
        request = Request(threshold_min=threshold, calibrations=_calibrated(drawn, sheet), crop_attached=True)

        answer = _corridor(drawn, sheet, request)

        assert answer.outcome.verdict == "undecidable"
        assert any("within 0.02 of the threshold" in reason for reason in answer.outcome.reasons)


class TestAnUncalibratedRegion:
    def test_it_yields_no_length_and_names_the_remedy(self):
        drawn, sheet = floor(stored_factor=0.5)

        answer = _corridor(drawn, sheet, Request(threshold_min=1.0))

        assert isinstance(answer, NoNumber)
        assert "no usable scale" in answer.reason and "confirm the scale" in answer.remedy
        assert "uncalibrated" in render(answer)

    def test_a_dimension_printed_on_the_span_is_passed_on_as_a_printed_figure_never_a_measurement(self):
        drawn, sheet = floor(stored_factor=0.5)

        answer = sheet_measure.clearance(
            sheet, drawn.share(-0.9, 3.05), drawn.share(-0.9, 4.15), Request(threshold_min=1.0, crop_attached=True)
        )

        assert isinstance(answer, Measurement) and answer.provenance == "printed_figure"
        assert answer.value == 1.2 and answer.interval == pytest.approx((1.195, 1.205))
        assert answer.outcome.verdict == "undecidable"
        assert "NOT measured" in render(answer)

    def test_a_scan_yields_no_length(self):
        _, sheet = floor()
        from agent.drawings.sheet_types import SegmentTable

        scan = replace(sheet, segments=SegmentTable.of([]), scan=True, memo={})

        answer = sheet_measure.distance(scan, (0.2, 0.2), (0.4, 0.4), Request())

        assert isinstance(answer, NoNumber)


class TestTwoRegions:
    def test_a_measurement_never_crosses_two(self):
        drawn, sheet = floor()
        left = replace(sheet.regions[0], box=(0.0, 0.0, sheet.point(drawn.share(2.0, 0))[0], sheet.height_pt), name="A")
        right = replace(sheet.regions[0], box=(left.box[2], 0.0, sheet.width_pt, sheet.height_pt), name="B")
        split = replace(sheet, regions=(left, right), memo={})

        answer = sheet_measure.clearance(split, drawn.share(0.05, 1.5), drawn.share(3.95, 1.5), Request())

        assert isinstance(answer, NoNumber) and "two scale regions" in answer.reason
        assert '"A"' in answer.reason and '"B"' in answer.reason


class TestSnappedPoints:
    def test_a_distance_between_two_corners_is_the_drawn_one(self):
        drawn, sheet = floor()
        rng = random.Random(7)
        for _ in range(50):
            jitter = [rng.uniform(-0.03, 0.03) for _ in range(4)]
            answer = sheet_measure.distance(
                sheet, drawn.share(0 + jitter[0], 0 + jitter[1]), drawn.share(4 + jitter[2], 3 + jitter[3]), Request()
            )

            assert isinstance(answer, Measurement), render(answer)
            assert answer.value == pytest.approx(5.0, abs=1e-3)

    def test_a_point_between_two_corners_is_refused_with_the_candidates(self):
        drawn, sheet = floor()

        answer = sheet_measure.distance(sheet, drawn.share(9.95, 0.02), drawn.share(4.0, 3.0), Request())

        assert isinstance(answer, NoNumber) and "point 1 could not be tied to the drawing" in answer.reason
        assert len(answer.candidates) >= 2

    def test_a_point_placed_on_a_candidate_takes_it(self):
        drawn, sheet = floor()
        refused = sheet_measure.distance(sheet, drawn.share(9.95, 0.02), drawn.share(4.0, 3.0), Request())
        corner = min(refused.candidates, key=lambda place: abs(place[0] - drawn.share(9.9, 0)[0]))

        answer = sheet_measure.distance(sheet, corner, drawn.share(4.0, 3.0), Request())

        assert isinstance(answer, Measurement) and answer.value == pytest.approx((5.9**2 + 9) ** 0.5, abs=2e-3)

    def test_a_point_near_nothing_is_refused(self):
        drawn, sheet = floor()

        answer = sheet_measure.distance(sheet, drawn.share(7.0, 5.2), drawn.share(4.0, 3.0), Request())

        assert isinstance(answer, NoNumber) and "no line end or intersection within reach" in answer.reason

    def test_a_path_is_the_sum_of_its_legs(self):
        drawn, sheet = floor()

        answer = sheet_measure.path(sheet, [drawn.share(0, 0), drawn.share(4, 0), drawn.share(4, 3)], Request())

        assert answer.quantity == "path" and answer.value == pytest.approx(7.0, abs=1e-3)

    def test_an_area_is_the_room_and_carries_twice_the_relative_error(self):
        drawn, sheet = floor()
        corners = [drawn.share(0, 0), drawn.share(4, 0), drawn.share(4, 3), drawn.share(0, 3)]
        request = Request(calibrations=_calibrated(drawn, sheet))

        answer = sheet_measure.area(sheet, corners, request)

        assert (answer.quantity, answer.unit, answer.provenance) == ("area", "m2", "vector_verified")
        assert answer.value == pytest.approx(12.0, abs=1e-3)
        low, high = answer.interval
        assert high - answer.value >= 2 * (1 / 283) * 12.0 - 1e-9 and low <= 12.0 <= high

    def test_an_area_threshold_is_decided_only_clear_of_its_outline(self):
        drawn, sheet = floor()
        corners = [drawn.share(0, 0), drawn.share(4, 0), drawn.share(4, 3), drawn.share(0, 3)]
        base = {"calibrations": _calibrated(drawn, sheet), "crop_attached": True}

        assert sheet_measure.area(sheet, corners, Request(threshold_min=10.0, **base)).outcome.verdict == "met"
        assert sheet_measure.area(sheet, corners, Request(threshold_min=14.0, **base)).outcome.verdict == "not_met"
        assert sheet_measure.area(sheet, corners, Request(threshold_min=11.9, **base)).outcome.verdict == "undecidable"

    def test_two_points_are_no_area_and_one_is_no_path(self):
        _, sheet = floor()

        assert isinstance(sheet_measure.area(sheet, [(0.1, 0.1), (0.2, 0.2)], Request()), NoNumber)
        assert isinstance(sheet_measure.path(sheet, [(0.1, 0.1)], Request()), NoNumber)


class TestTheIndex:
    def test_a_probe_looks_only_at_the_cells_it_passes(self):
        """Ten thousand segments far from the probe cost it nothing: it is handed the handful near its line."""
        page = SheetPage()
        page.line(100, 100, 100, 200)
        page.line(140, 100, 140, 200)
        rng = random.Random(3)
        for _ in range(10_000):
            x, y = rng.uniform(300, 1100), rng.uniform(300, 800)
            page.line(x, y, x + 4, y + 3)
        sheet = sheet_of(page)

        near = sheet_probe.index_of(sheet).near_line(
            sheet.share and (95.0, sheet.height_pt - 150), (145.0, sheet.height_pt - 150)
        )

        assert len(sheet.segments) == 10_002 and len(near) == 2


class TestWhatAnIndependentCheckRefuted:
    """Each case returned a wrong number with a tight interval, or a firm verdict, once."""

    @pytest.mark.parametrize("slant", [26, 30, 45, 60])
    def test_a_probe_far_askew_picks_no_span(self, slant):
        """Past 25 degrees the width was taken along the probe: 1.20 m read as 1.34 m and up, `met` against 1.30."""
        import math

        drawn, sheet = floor()
        shift = 1.0 * math.tan(math.radians(slant))
        request = Request(threshold_min=1.3, calibrations=_calibrated(drawn, sheet), crop_attached=True)

        answer = sheet_measure.clearance(sheet, drawn.share(5.0, 3.1), drawn.share(5.0 + shift, 4.1), request)

        assert isinstance(answer, NoNumber) and "place the two points square across" in answer.reason

    def test_a_path_through_a_wall_decides_nothing(self):
        drawn, sheet = floor()
        request = Request(threshold_min=1.0, calibrations=_calibrated(drawn, sheet), crop_attached=True)
        corners = [drawn.share(0, 0), drawn.share(4.5, 0), drawn.share(4.5, 3)]

        answer = sheet_measure.path(sheet, corners, request)

        assert answer.value == pytest.approx(7.5, abs=2e-3) and answer.inside == 1
        assert answer.outcome.verdict == "undecidable"

    def test_a_printed_figure_that_dimensions_something_else_is_not_the_spans_figure(self):
        """Along the first chain from 0 to 4,50: the nearest figure is the 4,00, which dimensions 0 to 4,00."""
        drawn, sheet = floor(stored_region=False, scale_note=False)

        answer = sheet_measure.clearance(
            sheet, drawn.share(0.05, -0.9), drawn.share(4.45, -0.9), Request(), between=None
        )

        assert isinstance(answer, NoNumber) and answer.printed is None

    def test_the_figure_of_exactly_this_span_is_passed_on(self):
        drawn, sheet = floor(stored_region=False, scale_note=False)

        answer = sheet_measure.clearance(sheet, drawn.share(-0.9, 3.05), drawn.share(-0.9, 4.15), Request())

        assert isinstance(answer, Measurement) and answer.provenance == "printed_figure" and answer.value == 1.2

    def test_a_span_ending_on_a_dashed_line_says_so(self):
        page = SheetPage()
        page.line(100, 100, 100, 400)
        page.style(width=0.5, dash=(3, 2))
        page.line(200, 100, 200, 400)
        sheet = sheet_of(page)
        whole = [Calibration((0.0, 0.0, sheet.width_pt, sheet.height_pt), 0.01, 300.0)]

        answer = sheet_measure.clearance(
            sheet, sheet.share((103, 600)), sheet.share((197, 600)), Request(calibrations=whole)
        )

        assert any("dashed" in note for note in answer.notes)

    def test_a_point_in_dense_linework_is_refused_not_moved_to_a_hatch_end(self):
        """Two walls cross at a corner with no line end there; a hundred hatch lines pass within reach."""
        page = SheetPage()
        page.line(100, 500, 300, 500)
        page.line(200, 400, 200, 600)
        for index in range(100):
            offset = index * 0.1
            page.line(196 + offset, 494, 206 + offset, 504)
        sheet = sheet_of(page)
        corner = sheet.share((200.3, sheet.height_pt - 499.6))

        answer = sheet_measure.distance(sheet, corner, sheet.share((100.0, sheet.height_pt - 500.0)), Request())

        assert isinstance(answer, NoNumber) and "too many to tell its corners apart" in answer.reason

    def test_corners_out_of_order_enclose_no_area(self):
        drawn, sheet = floor()
        bow_tie = [drawn.share(0, 0), drawn.share(4, 3), drawn.share(4, 0), drawn.share(0, 3)]

        answer = sheet_measure.area(sheet, bow_tie, Request(threshold_min=5.0))

        assert isinstance(answer, NoNumber) and "crosses itself" in answer.reason

    def test_a_span_that_passes_over_another_region_is_refused(self):
        """Both ends in the floor's region, a detail's own stored region between them."""
        drawn, sheet = floor(stored_unit="m")
        (x0, y0), (x1, y1) = sheet.point(drawn.share(4.8, 4.0)), sheet.point(drawn.share(5.6, 3.2))
        detail = replace(
            sheet.regions[0],
            box=(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)),
            name="Detail",
            x=(("m", 0.0035),),
        )
        nested = replace(sheet, regions=(*sheet.regions, detail), memo={})

        answer = sheet_measure.clearance(nested, drawn.share(0.1, 3.6), drawn.share(9.9, 3.6), Request())

        assert isinstance(answer, NoNumber) and "touches two scale regions" in answer.reason
