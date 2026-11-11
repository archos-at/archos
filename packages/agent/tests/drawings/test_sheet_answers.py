"""An answer cannot be built without what it rests on, and a figure's form says what it is."""

from __future__ import annotations

import pytest
from agent_testing.sheets import floor
from agent_testing.sheets import sheet_of
from knowledge_layer_testing.sheet_fixtures import SheetPage

from agent.drawings import sheet_figures
from agent.drawings.sheet_answers import Measurement
from agent.drawings.sheet_answers import render
from agent.drawings.sheet_scale import ScaleReading
from agent.drawings.sheet_types import Figure

SCALE = ScaleReading("verified", 0.0352778, (0.0, 0.0, 100.0, 100.0), "calibration", "a person's calibration")
NO_SCALE = ScaleReading("uncalibrated", None, (0.0, 0.0, 100.0, 100.0), "none", "", reason="no scale")


def _measurement(**changes: object) -> Measurement:
    fields = {
        "quantity": "clearance",
        "value": 1.2,
        "unit": "m",
        "interval": (1.19, 1.21),
        "provenance": "vector_verified",
        "page": 1,
        "points": ((0.1, 0.1), (0.2, 0.1)),
        "scale": SCALE,
    }
    return Measurement(**{**fields, **changes})


class TestAMeasurementNeedsWhatItRestsOn:
    def test_without_provenance_it_cannot_be_constructed(self):
        with pytest.raises(TypeError):
            Measurement("clearance", 1.2, "m", (1.19, 1.21))  # type: ignore[call-arg]

    @pytest.mark.parametrize("provenance", ["", "measured", None])
    def test_a_provenance_outside_the_three_is_refused(self, provenance):
        with pytest.raises(ValueError, match="needs a provenance"):
            _measurement(provenance=provenance)

    @pytest.mark.parametrize("interval", [(1.21, 1.3), (1.0, 1.19), (1.3, 1.1)])
    def test_an_interval_that_does_not_hold_the_value_is_refused(self, interval):
        with pytest.raises(ValueError, match="interval that holds its value"):
            _measurement(interval=interval)

    def test_a_measured_value_without_a_scale_is_refused(self):
        with pytest.raises(ValueError, match="needs a scale"):
            _measurement(scale=NO_SCALE)

    def test_a_value_cannot_call_itself_verified_over_an_estimated_scale(self):
        from dataclasses import replace

        with pytest.raises(ValueError, match="does not match a scale that is estimated"):
            _measurement(scale=replace(SCALE, state="estimated"))

    def test_a_printed_figure_needs_no_scale(self):
        assert _measurement(provenance="printed_figure", scale=NO_SCALE).value == 1.2

    def test_the_rendering_states_the_number_its_interval_its_provenance_and_its_scale(self):
        text = render(_measurement())

        assert text.splitlines()[0] == "clearance: 1.200 m (interval 1.190 m to 1.210 m)"
        assert "Provenance: vector_verified" in text and "Scale: 1:100 (verified; from a person's calibration)" in text


def _figure(text: str, raised: str = "") -> Figure:
    return Figure(text, raised, (0.0, 0.0, 10.0, 5.0), (5.0, 2.5), 0, (1.0, 0.0), 7.0)


class TestAFiguresForm:
    @pytest.mark.parametrize(
        ("text", "kind"),
        [
            ("2,38", "dimension"),
            ("238", "dimension"),
            ("+3,25", "level_mark"),
            ("±0,00", "level_mark"),
            ("-2,80", "level_mark"),
            ("90/210", "opening_size"),
            ("M 1:100", "scale_note"),
            ("1:50", "scale_note"),
            ("Wohnen", "other"),
            ("Top 3", "other"),
        ],
    )
    def test_its_kind_is_read_off_its_form(self, text, kind):
        assert sheet_figures.classify(_figure(text)) == kind

    def test_a_long_sentence_that_holds_a_ratio_is_no_scale_note(self):
        assert sheet_figures.scale_ratio(_figure("Mischungsverhältnis 1:3 laut Herstellerangabe beachten")) is None

    @pytest.mark.parametrize(
        ("text", "raised", "metres", "resolution"),
        [
            ("2,38", "", 2.38, 0.01),
            ("2,38⁵", "5", 2.385, 0.005),
            ("88", "", 0.88, 0.01),
            ("88⁵", "5", 0.885, 0.005),
            ("12.50", "", 12.5, 0.01),
        ],
    )
    def test_a_dimension_parses_under_the_mixed_convention(self, text, raised, metres, resolution):
        convention = sheet_figures.UnitConvention("metres_and_centimetres", "")

        parsed = sheet_figures.parse_dimension(_figure(text, raised), convention)

        assert parsed.metres == pytest.approx(metres) and parsed.resolution == pytest.approx(resolution)

    @pytest.mark.parametrize("text", ["400,0", "2,5", "1.5"])
    def test_one_decimal_is_read_as_nothing(self, text):
        """As often centimetres, a slope or a room number as metres."""
        convention = sheet_figures.UnitConvention("metres_and_centimetres", "")

        assert not sheet_figures.is_numeric(_figure(text))
        assert sheet_figures.parse_dimension(_figure(text), convention) is None

    def test_nothing_parses_under_an_undetermined_convention(self):
        convention = sheet_figures.unit_convention([_figure("400"), _figure("250")])

        assert convention.name == "undetermined"
        assert sheet_figures.parse_dimension(_figure("400"), convention) is None

    def test_the_convention_states_its_evidence(self):
        convention = sheet_figures.unit_convention([_figure("4,00"), _figure("50"), _figure("Wohnen")])

        assert convention.name == "metres_and_centimetres"
        assert convention.evidence == "1 decimal figures read as metres, 1 whole numbers read as centimetres"

    def test_room_stamps_are_the_blocks_that_print_an_area(self):
        _, sheet = floor()

        stamps = [[sheet.figures[index].text for index in block] for block in sheet_figures.room_stamps(sheet.figures)]

        assert sorted(stamps) == [["Wohnen", "12,00 m2"], ["Zimmer", "16,50 m2"]]

    def test_a_lone_area_is_a_stamp_of_one_line_and_a_lone_name_is_none(self):
        page = SheetPage()
        page.text(100, 400, "23,45 m²".replace("²", "2"), size=9)
        page.text(500, 400, "Flur", size=9)
        sheet = sheet_of(page)

        stamps = sheet_figures.room_stamps(sheet.figures)

        assert [[sheet.figures[index].text for index in block] for block in stamps] == [["23,45 m2"]]
