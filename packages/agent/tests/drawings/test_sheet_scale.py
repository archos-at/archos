"""The scale at a point: a person's, or a hint the sheet's own figures corroborate, or none.

Every sheet here is drawn at known dimensions (``knowledge_layer_testing.drawing_sheets``), written as a PDF
and read back through the reader, so the scale check runs on what a plot holds: linework and characters.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from agent_testing.sheets import floor
from agent_testing.sheets import sheet_of
from knowledge_layer_testing.drawing_sheets import PAPER_M_PER_PT
from knowledge_layer_testing.pdf_fixtures import build_plan_set_pdf
from knowledge_layer_testing.sheet_fixtures import SheetPage
from knowledge_layer_testing.sheet_fixtures import dimension

from agent.drawings import sheet_scale
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_scale import scale_at
from agent.drawings.sheet_types import Sheet

MIDDLE = (5.0, 3.6)


def _reading(**options: object) -> sheet_scale.ScaleReading:
    drawn, sheet = floor(**options)
    return scale_at(sheet, sheet.point(drawn.share(*MIDDLE)))


def _fresh(sheet: Sheet, **changes: object) -> Sheet:
    return replace(sheet, memo={}, **changes)


class TestAStoredRegion:
    @pytest.mark.parametrize("rotate", [0, 90, 180, 270])
    @pytest.mark.parametrize("cropped", [False, True])
    def test_it_decodes_and_is_corroborated_on_every_rotation_and_a_cropped_page(self, rotate, cropped):
        reading = _reading(rotate=rotate, cropped=cropped)

        assert reading.state == "estimated" and reading.source == "stored_region"
        assert reading.ratio == pytest.approx(100.0, rel=1e-6)
        assert (reading.agreeing, reading.total) == (8, 8)
        # An estimate is no finer than the check behind it: the figures tell scales apart to 0.5 %.
        assert reading.relative_error == sheet_scale.AGREEMENT_TOLERANCE

    def test_the_strict_match_agrees_with_every_dimension_drawn(self):
        """The specification's measurement, repeated with decision 5's match: the nearest terminator each side."""
        drawn, sheet = floor()
        hint = sheet_scale.hint_at(sheet, sheet.point(drawn.share(*MIDDLE)))

        found = sheet_scale.corroborate(sheet, hint)

        assert sorted(check.figure.text for check in found.checks) == sorted(text for _, text in drawn.dimensions)
        assert all(check.agrees for check in found.checks) and len(found.checks) == 8
        assert max(check.deviation for check in found.checks) < 1e-4

    def test_a_view_drawn_at_twenty_degrees_is_corroborated(self):
        assert _reading(view_angle=20.0).state == "estimated"

    def test_an_empty_unit_label_is_said_to_be_assumed(self):
        assert "metres assumed, as its ratio text says" in _reading().label
        assert "assumed" not in _reading(stored_unit="m").label

    def test_a_unit_label_of_millimetres_decodes_to_the_same_scale(self):
        assert _reading(stored_unit="mm").ratio == pytest.approx(100.0, rel=1e-6)

    @pytest.mark.parametrize("factor", [0.1, 0.5, 0.707, 0.99, 0.9949, 1.0051, 1.01, 1.414, 2.0, 10.0, 100.0])
    @pytest.mark.parametrize("unit", ["m", "cm", "mm"])
    def test_a_wrong_scale_is_uncalibrated_whatever_its_unit_label_says(self, factor, unit):
        reading = _reading(stored_factor=factor, stored_unit=unit)

        assert reading.state == "uncalibrated" and reading.metres_per_point is None
        assert (reading.agreeing, reading.total) == (0, 8)
        assert "is not corroborated: 0 of 8 dimension figures agree" in reading.reason

    @pytest.mark.parametrize("factor", [0.5, 0.707, 1.414, 2.0, 100.0])
    def test_a_factor_without_a_unit_label_that_nothing_else_states_is_uncalibrated(self, factor):
        """The sheet's ratio text and its note say 1:100; the unlabelled factor decodes to something else."""
        reading = _reading(stored_factor=factor)

        assert reading.state == "uncalibrated"
        assert "names no unit for its scale factor" in reading.reason

    def test_an_unlabelled_factor_needs_a_second_witness_of_its_unit(self):
        drawn, sheet = floor(scale_note=False)
        silent = _fresh(sheet, regions=(replace(sheet.regions[0], ratio=""),))

        assert scale_at(sheet, sheet.point(drawn.share(*MIDDLE))).state == "estimated"
        assert scale_at(silent, sheet.point(drawn.share(*MIDDLE))).state == "uncalibrated"

    def test_a_file_drawn_in_centimetres_with_no_unit_label_is_not_read_a_hundred_times_too_large(self):
        """Factor and figures both in centimetres („400,0“): under „metres assumed“ they would agree at 1:10000."""
        import knowledge_layer_testing.drawing_sheets as sheets

        original = sheets.label
        sheets.label = lambda metres: f"{metres * 100:.1f}".replace(".", ",")
        try:
            reading = _reading(stored_factor=100.0)
        finally:
            sheets.label = original

        assert reading.state == "uncalibrated"

    def test_the_interval_of_an_estimate_holds_the_truth_at_the_edge_of_what_the_check_accepts(self):
        """A stored factor 0.4 % off is corroborated (inside 0.5 %); the value it yields must still hold 10.000 m."""
        from agent.drawings import sheet_measure

        drawn, sheet = floor(stored_factor=1.004, stored_unit="m")

        answer = sheet_measure.clearance(sheet, drawn.share(0.1, 3.6), drawn.share(9.9, 3.6), sheet_measure.Request())

        assert answer.scale.state == "estimated" and answer.value == pytest.approx(10.04, abs=1e-3)
        assert answer.interval[0] <= 10.0 <= answer.interval[1]

    @pytest.mark.parametrize("replot", [0.5, 0.707, 1.414])
    def test_a_sheet_plotted_again_at_another_size_with_its_regions_intact_is_uncalibrated(self, replot):
        assert _reading(replot=replot).state == "uncalibrated"

    def test_dense_hatching_does_not_corroborate_a_wrong_scale(self):
        drawn, sheet = floor(hatching=True, stored_factor=0.5)

        assert len(sheet.segments) > 150
        assert scale_at(sheet, sheet.point(drawn.share(*MIDDLE))).state == "uncalibrated"

    def test_dense_hatching_does_not_hide_a_right_one(self):
        assert _reading(hatching=True).state == "estimated"

    @pytest.mark.parametrize(
        ("change", "said"),
        [
            ({"y": (("m", 0.07),)}, "separate scale for the y axis"),
            ({"cyx": 2.0}, "y-to-x factor"),
            ({"subtype": "GEO"}, "not a rectilinear measure"),
            ({"x": (("ft", 0.1),)}, 'states its scale in "ft"'),
            ({"x": ()}, "stores no scale factor"),
        ],
    )
    def test_a_region_this_build_does_not_read_is_refused_with_the_reason(self, change, said):
        drawn, sheet = floor()
        sheet = _fresh(sheet, regions=(replace(sheet.regions[0], **change),))

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)))

        assert reading.state == "uncalibrated" and said in reading.reason

    def test_a_point_outside_every_stored_region_has_no_scale_from_a_note(self):
        drawn, sheet = floor()

        reading = scale_at(sheet, (sheet.width_pt - 5, 5.0))

        assert reading.state == "uncalibrated" and "outside every region" in reading.reason

    def test_the_smallest_region_containing_the_point_is_the_one_read(self):
        drawn, sheet = floor()
        whole = replace(
            sheet.regions[0], box=(0.0, 0.0, sheet.width_pt, sheet.height_pt), name="Sheet", x=(("m", 1.0),)
        )
        sheet = _fresh(sheet, regions=(whole, sheet.regions[0]))

        assert 'region "Floor"' in scale_at(sheet, sheet.point(drawn.share(*MIDDLE))).label


class TestAPrintedScaleNote:
    def test_alone_it_is_only_a_hint_and_the_figures_decide(self):
        reading = _reading(stored_region=False)

        assert (reading.state, reading.source) == ("estimated", "scale_note")
        assert reading.relative_error == sheet_scale.SCALE_NOTE_ERROR
        assert reading.label == "the printed scale note 1:100"

    def test_a_note_the_figures_contradict_never_yields_a_scale(self):
        """A sheet plotted at half size still prints „M 1:100“."""
        reading = _reading(stored_region=False, replot=0.5)

        assert reading.state == "uncalibrated" and reading.metres_per_point is None

    def test_two_different_notes_and_no_stored_region_is_uncalibrated(self):
        drawn, _ = floor(stored_region=False)
        drawn.page.text(1900, 90, "Detail 1:20", size=10)

        reading = scale_at(sheet_of(drawn.page), (500.0, 500.0))

        assert reading.state == "uncalibrated" and "different scale notes (1:20, 1:100)" in reading.reason

    def test_no_note_and_no_region_is_uncalibrated(self):
        reading = _reading(stored_region=False, scale_note=False)

        assert reading.state == "uncalibrated" and "prints no scale note" in reading.reason


class TestTheUnitConvention:
    def test_whole_numbers_alone_are_undetermined_and_corroborate_nothing(self):
        """Centimetres and millimetres differ by ten: a scale wrong by ten would agree under the other reading."""
        page = SheetPage()
        for index, centimetres in enumerate((400, 250, 120, 365)):
            start = (100.0, 700.0 - 60 * index)
            dimension(page, start, (start[0] + centimetres / 100 / (100 * PAPER_M_PER_PT), start[1]), str(centimetres))
        page.text(900, 60, "M 1:100", size=12)

        reading = scale_at(sheet_of(page), (150.0, 170.0))

        assert reading.state == "uncalibrated"
        assert "cannot be told" in reading.reason and "4 whole numbers" in reading.reason

    def test_a_raised_digit_on_a_whole_number_says_centimetres(self):
        page = SheetPage()
        for index, centimetres in enumerate((400.0, 250.5, 120.0, 365.0)):
            start = (100.0, 700.0 - 60 * index)
            end = (start[0] + centimetres / 100 / (100 * PAPER_M_PER_PT), start[1])
            whole, half = divmod(centimetres, 1)
            dimension(page, start, end, str(int(whole)), raised="5" if half else "")
        page.text(900, 60, "M 1:100", size=12)
        sheet = sheet_of(page)

        # The figures all read one way: they corroborate the note, and vouch for no place (no two directions).
        found = sheet_scale.corroborate(sheet, sheet_scale.note_hint(sheet))

        assert found.convention.name == "centimetres"
        assert found.corroborated and (found.agreeing, len(found.checks)) == (4, 4)

    def test_fewer_than_three_agreeing_figures_corroborate_nothing(self):
        page = SheetPage()
        for index, metres in enumerate((4.0, 2.5)):
            start = (100.0, 700.0 - 60 * index)
            dimension(
                page, start, (start[0] + metres / (100 * PAPER_M_PER_PT), start[1]), f"{metres:.2f}".replace(".", ",")
            )
        page.text(900, 60, "M 1:100", size=12)

        reading = scale_at(sheet_of(page), (150.0, 170.0))

        assert reading.state == "uncalibrated" and "2 of 2 dimension figures agree" in reading.reason

    def test_under_eighty_percent_agreement_corroborates_nothing(self):
        """Three true dimensions and one drawn a tenth short: 3 of 4 is 75 %."""
        page = SheetPage()
        for index, (metres, drawn) in enumerate(((4.0, 4.0), (2.5, 2.5), (1.2, 1.2), (3.65, 3.3))):
            start = (100.0, 700.0 - 60 * index)
            dimension(
                page, start, (start[0] + drawn / (100 * PAPER_M_PER_PT), start[1]), f"{metres:.2f}".replace(".", ",")
            )
        page.text(900, 60, "M 1:100", size=12)

        reading = scale_at(sheet_of(page), (150.0, 170.0))

        assert reading.state == "uncalibrated" and "3 of 4 dimension figures agree" in reading.reason


class TestWhatEndsADimension:
    def test_the_extension_line_of_a_chain_further_out_ends_nothing(self):
        """The outer chain's extension line at 7,385 runs through the inner chain's 5,50 span."""
        drawn, sheet = floor()
        figure = next(figure for figure in sheet.figures if figure.text == "5,50")

        span = sheet_scale.dimension_span(sheet, figure)

        assert span * drawn.true_metres_per_point == pytest.approx(5.5, abs=1e-3)

    def test_a_dimension_set_inside_the_drawing_spans_its_own_segment_whatever_ends_near_it(self):
        """On a real 1:50 plot, lines stopping within reach of a dimension line (wall hatching, other ticks) cut
        22 of 65 spans short. A dimension drawn as its own segment ends in a tick at each end: that is the span."""
        page = SheetPage()
        metres = 2.63
        end = 100.0 + metres / (50 * PAPER_M_PER_PT)
        dimension(page, (100.0, 500.0), (end, 500.0), "2,63")
        for x in (130.0, 142.0, 171.0):
            page.line(x, 496.0, x + 3, 508.0)

        sheet = sheet_of(page)

        span = sheet_scale.dimension_span(sheet, sheet.figures[0])
        assert span * 50 * PAPER_M_PER_PT == pytest.approx(metres, abs=1e-3)

    def test_a_chain_drawn_as_one_line_is_read_between_its_ticks_and_a_line_running_through_ends_nothing(self):
        per_metre = 1 / (100 * PAPER_M_PER_PT)
        page = SheetPage()
        page.line(100.0 - 20, 500.0, 100.0 + 10 * per_metre + 20, 500.0)
        for station in (0.0, 4.0, 10.0):
            x = 100.0 + station * per_metre
            page.line(x - 2.5, 497.5, x + 2.5, 502.5)
        through = 100.0 + 7.0 * per_metre
        page.line(through, 400.0, through, 600.0)
        page.text(100.0 + 6.6 * per_metre, 502.0, "6,00", size=7)

        sheet = sheet_of(page)

        span = sheet_scale.dimension_span(sheet, sheet.figures[0])
        assert span * 100 * PAPER_M_PER_PT == pytest.approx(6.0, abs=1e-3)

    def test_a_number_on_no_dimension_line_is_no_dimension(self):
        page = SheetPage()
        page.text(300, 300, "104", size=8)
        page.line(100, 100, 500, 100)

        sheet = sheet_of(page)

        assert sheet_scale.dimension_span(sheet, sheet.figures[0]) is None

    def test_arrowheads_end_a_dimension(self):
        page = SheetPage()
        for index, metres in enumerate((4.0, 2.5, 1.2)):
            y = 700.0 - 60 * index
            x1 = 100.0 + metres / (100 * PAPER_M_PER_PT)
            page.line(100.0, y, x1, y)
            for tip, back in ((100.0, 6.0), (x1, -6.0)):
                page.line(tip, y, tip + back, y + 1.5)
                page.line(tip, y, tip + back, y - 1.5)
            page.text((100.0 + x1) / 2 - 8, y + 2, f"{metres:.2f}".replace(".", ","), size=7)
        page.text(900, 60, "M 1:100", size=12)
        sheet = sheet_of(page)

        found = sheet_scale.corroborate(sheet, sheet_scale.note_hint(sheet))

        assert found.corroborated and (found.agreeing, len(found.checks)) == (3, 3)

    def test_dimensions_that_all_read_one_way_vouch_for_no_place(self):
        """Three agreeing dimensions, all horizontal: what lies under them may be another view."""
        page = SheetPage()
        for index, metres in enumerate((4.0, 2.5, 1.2)):
            start = (100.0, 700.0 - 60 * index)
            dimension(
                page, start, (start[0] + metres / (100 * PAPER_M_PER_PT), start[1]), f"{metres:.2f}".replace(".", ",")
            )
        page.text(900, 60, "M 1:100", size=12)

        reading = scale_at(sheet_of(page), (150.0, 170.0))

        assert reading.state == "uncalibrated" and (reading.agreeing, reading.total) == (3, 3)
        assert "runs past this place in two directions" in reading.reason


class TestAScanAndAUserUnit:
    def test_a_page_without_linework_has_no_scale(self):
        from knowledge_layer.sheet.reader import read_sheet

        from agent.drawings.sheet_types import sheet_from_plain

        pdf = build_plan_set_pdf(raster_pages=1, rasters_per_page=1, text_pages=0, raster_px=(64, 48))
        sheet = sheet_from_plain(read_sheet(pdf, 1), [])

        reading = scale_at(sheet, (10.0, 10.0))

        assert sheet.scan and reading.state == "uncalibrated" and "no linework" in reading.reason

    def test_a_user_unit_other_than_one_is_refused(self):
        drawn, sheet = floor()

        reading = scale_at(_fresh(sheet, user_unit=2.0), sheet.point(drawn.share(*MIDDLE)))

        assert reading.state == "uncalibrated" and "user unit of 2" in reading.reason


class TestAPersonsCalibration:
    def _calibration(self, drawn, sheet, factor: float = 1.0) -> Calibration:
        return Calibration(sheet.regions[0].box, drawn.true_metres_per_point * factor, 283.0, "calibration by A.")

    def test_it_is_verified_inside_its_region_and_carries_one_point_over_its_reference(self):
        drawn, sheet = floor()

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)), [self._calibration(drawn, sheet)])

        assert (reading.state, reading.source, reading.contradiction) == ("verified", "calibration", "")
        assert reading.relative_error == pytest.approx(1 / 283)

    def test_it_leaves_a_point_outside_its_region_as_it_was(self):
        drawn, sheet = floor()

        reading = scale_at(sheet, (sheet.width_pt - 5, 5.0), [self._calibration(drawn, sheet)])

        assert reading.state == "uncalibrated"

    def test_it_makes_an_uncorroborated_region_verified(self):
        drawn, sheet = floor(replot=0.707, stored_region=False)
        box = (0.0, 0.0, sheet.width_pt, sheet.height_pt)
        calibration = Calibration(box, drawn.true_metres_per_point, 200.0)

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)), [calibration])

        assert reading.state == "verified" and reading.contradiction == ""

    def test_one_that_disagrees_with_its_stored_region_is_reported(self):
        drawn, sheet = floor()

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)), [self._calibration(drawn, sheet, 1.05)])

        assert reading.state == "verified"
        assert "the calibration says 1:105.0" in reading.contradiction and "says 1:100.0" in reading.contradiction

    def test_one_that_disagrees_with_the_figures_is_reported(self):
        drawn, sheet = floor(stored_region=False)
        box = (0.0, 0.0, sheet.width_pt, sheet.height_pt)

        reading = scale_at(sheet, (300.0, 300.0), [Calibration(box, drawn.true_metres_per_point * 1.05, 283.0)])

        assert "only 0 of the 8 dimension figures in the region agree" in reading.contradiction

    def test_the_smallest_calibration_covering_the_point_is_the_one_read(self):
        drawn, sheet = floor()
        whole = Calibration((0.0, 0.0, sheet.width_pt, sheet.height_pt), 1.0, 100.0, "whole sheet")

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)), [whole, self._calibration(drawn, sheet)])

        assert reading.label == "calibration by A."


class TestWhatAnIndependentCheckRefuted:
    """Each case returned a wrong scale as `estimated`, or left a wrong calibration uncontradicted, once."""

    def test_a_room_number_does_not_decide_how_lengths_are_printed(self):
        """A sheet dimensioned in whole millimetres, its scale wrong by ten, and one text „1.05“ in the region."""
        import knowledge_layer_testing.drawing_sheets as sheets

        original = sheets.label
        sheets.label = lambda metres: str(round(metres * 1000))
        try:
            drawn, _ = floor(stored_factor=10.0, stored_unit="m")
        finally:
            sheets.label = original
        drawn.page.text(*drawn.at(7.0, 5.0), "1.05", size=8)
        sheet = sheet_of(drawn.page)

        reading = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)))

        assert reading.state == "uncalibrated" and "cannot be told" in reading.reason

    def test_figures_do_not_vouch_for_a_view_they_are_not_in(self):
        """One note „M 1:100“, the floor at 1:100, and a small second view drawn at 1:50 with its own dimension."""
        drawn, _ = floor(stored_region=False)
        left = 1500.0
        dimension(drawn.page, (left, 1300.0), (left + 2.0 / (50 * PAPER_M_PER_PT), 1300.0), "2,00")
        drawn.page.rect(left, 1320.0, 2.0 / (50 * PAPER_M_PER_PT), 60.0)
        sheet = sheet_of(drawn.page)

        in_the_detail = scale_at(sheet, sheet.point(drawn.page.shown_share(left + 50, 1340.0)))
        on_the_floor = scale_at(sheet, sheet.point(drawn.share(*MIDDLE)))

        assert on_the_floor.state == "estimated"
        assert in_the_detail.state == "uncalibrated"
        assert "corroborated elsewhere on the sheet" in in_the_detail.reason

    def test_a_place_far_from_every_agreeing_dimension_has_no_scale(self):
        drawn, sheet = floor(stored_region=False)

        reading = scale_at(sheet, (sheet.width_pt - 30, 40.0))

        assert reading.state == "uncalibrated" and "runs past this place in two directions" in reading.reason

    def test_two_ratios_in_one_note_are_two_notes(self):
        drawn, _ = floor(stored_region=False, scale_note=False)
        drawn.page.text(1900, 120, "M 1:100, 1:50", size=12)

        reading = scale_at(sheet_of(drawn.page), (500.0, 500.0))

        assert "different scale notes (1:50, 1:100)" in reading.reason

    def test_a_calibration_over_few_figures_is_held_against_what_the_sheet_corroborates_there(self):
        """Twice the true scale, in a box over the corridor alone; the note and eight figures say 1:100."""
        drawn, sheet = floor(stored_region=False)
        (x0, y0), (x1, y1) = sheet.point(drawn.share(1.0, 4.1)), sheet.point(drawn.share(9.0, 3.1))
        box = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

        reading = scale_at(
            sheet, sheet.point(drawn.share(5.0, 3.6)), [Calibration(box, 2 * drawn.true_metres_per_point, 283.0)]
        )

        assert reading.state == "verified"
        assert "the sheet's own figures corroborate 1:100.0 here" in reading.contradiction

    def test_two_calibrations_that_disagree_at_a_place_contradict_each_other(self):
        drawn, sheet = floor(stored_region=False, scale_note=False)
        whole = (0.0, 0.0, sheet.width_pt, sheet.height_pt)
        inner = (100.0, 100.0, sheet.width_pt - 100, sheet.height_pt - 100)
        both = [Calibration(whole, 0.03, 300.0), Calibration(inner, 0.04, 300.0)]

        reading = scale_at(sheet, (500.0, 500.0), both)

        assert "another calibration covering this place says 1:85.0" in reading.contradiction

    @pytest.mark.parametrize("scale", [0.0, -0.01])
    def test_a_calibration_needs_a_positive_scale(self, scale):
        with pytest.raises(ValueError, match="positive scale"):
            Calibration((0.0, 0.0, 10.0, 10.0), scale, 100.0)
