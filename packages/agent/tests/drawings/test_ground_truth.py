"""The release gate of measuring on a sheet: no answer states a number whose true value lies outside its interval.

The set is ``knowledge_layer_testing.ground_truth_sheets``: sheets drawn at known dimensions, most of them
saying something false about themselves. Every probe is asked through the functions the tool calls, as placed
and with every point moved a little, without a calibration and with a correct one. „No number“ passes the gate;
``scripts/drawing_ground_truth_report.py`` counts how often that is the answer and why.
"""

from __future__ import annotations

import pytest
from agent_testing import ground_truth
from agent_testing.ground_truth import Drawn
from agent_testing.ground_truth import Result
from agent_testing.ground_truth import describe
from knowledge_layer_testing.ground_truth_sheets import jittered

from agent.drawings.sheet_answers import Measurement
from agent.drawings.sheet_answers import NoNumber

WRONG_CALIBRATIONS = (0.5, 0.9, 0.98, 1.02, 1.1, 2.0)


@pytest.fixture(scope="module")
def drawn() -> list[Drawn]:
    return ground_truth.read_set()


@pytest.fixture(scope="module")
def uncalibrated(drawn) -> list[Result]:
    return ground_truth.run(drawn, calibrated=False)


@pytest.fixture(scope="module")
def calibrated(drawn) -> list[Result]:
    return ground_truth.run(drawn, calibrated=True)


def _by_name(drawn: list[Drawn], name: str) -> Drawn:
    return next(item for item in drawn if item.truth.name == name)


def _of(results: list[Result], sheet: str, view: str = "") -> list[Result]:
    return [result for result in results if result.sheet == sheet and f"/{view}" in result.probe.name]


class TestTheSet:
    def test_every_sheet_is_read_as_linework_with_probes_of_all_four_operations(self, drawn):
        assert len(drawn) >= 16
        for item in drawn:
            assert not item.sheet.scan and len(item.sheet.segments) > 30, item.truth.name
            assert {probe.operation for probe in item.truth.truths} == {"clearance", "distance", "path", "area"}

    def test_it_carries_what_the_gate_is_about(self, drawn):
        names = {item.truth.name for item in drawn}
        assert {
            "two_regions",
            "rotated_view",
            "centimetres",
            "wrong_note",
            "replotted_a2",
            "print_rounded",
            "undimensioned_detail",
        } <= names
        hatched = _by_name(drawn, "stored_region").sheet
        plain = _by_name(drawn, "note_only").sheet
        assert len(hatched.segments) > 3 * len(plain.segments)
        assert _by_name(drawn, "rotated_view").sheet.rotation == 90
        assert len(_by_name(drawn, "two_regions").sheet.regions) == 2

    def test_a_probe_moved_by_hand_is_the_same_probe_every_run(self, drawn):
        first, second = drawn[0].probes(), drawn[0].probes()
        assert first == second and len(first) == 7 * len(drawn[0].truth.truths)


class TestTheReleaseGate:
    def test_without_a_calibration_no_number_is_stated_whose_true_value_lies_outside_its_interval(self, uncalibrated):
        failures = ground_truth.outside(uncalibrated)

        assert not failures, "\n".join(describe(failure) for failure in failures[:40])

    def test_with_a_correct_calibration_no_number_is_stated_whose_true_value_lies_outside_its_interval(
        self, calibrated
    ):
        failures = ground_truth.outside(calibrated)

        assert not failures, "\n".join(describe(failure) for failure in failures[:40])

    @pytest.mark.parametrize(("radius", "seed"), [(1.0, 10), (2.0, 12), (3.0, 11)])
    def test_a_less_steady_hand_keeps_the_gate(self, drawn, radius, seed):
        """Every point moved by up to 3 pt (1 mm on paper), with seeds that once failed: a point placed two
        points from a corner sat within a point of the hatch end beside it and took that. Past 3 pt a placed
        point can be out of reach of its face and in reach of another line; the script counts where that starts."""
        moved = [
            result for item in drawn for result in ground_truth.run([item], True, jittered(item.truth, radius, 5, seed))
        ]

        assert sum(result.stated for result in moved) > 300
        failures = ground_truth.outside(moved)
        assert not failures, "\n".join(describe(failure) for failure in failures[:40])

    def test_the_gate_is_not_passed_by_saying_nothing(self, uncalibrated, calibrated):
        """Where the sheet's statement about its scale is true and readable, numbers are stated."""
        for sheet in ("stored_region", "note_only", "two_regions", "rotated_view", "centimetres"):
            assert sum(result.stated for result in _of(uncalibrated, sheet)) >= 20, sheet
        assert sum(result.stated for result in calibrated) > sum(result.stated for result in uncalibrated) > 200

    def test_a_probe_from_one_view_into_another_gets_no_number(self, uncalibrated, calibrated):
        across = [result for result in (*uncalibrated, *calibrated) if result.probe.refuse]

        assert len(across) >= 40 and not any(result.stated for result in across)

    @pytest.mark.parametrize(
        "sheet", ["wrong_note", "wrong_stored_region", "replotted_a2", "replotted_to_fit", "two_views_one_note"]
    )
    def test_a_sheet_whose_stated_scale_is_false_gets_no_measured_number(self, uncalibrated, sheet):
        view = "view2" if sheet == "two_views_one_note" else "view1"
        answers = [result.answer for result in _of(uncalibrated, sheet, view)]

        measured = [answer for answer in answers if isinstance(answer, Measurement) and answer.scale.metres_per_point]
        assert answers and not measured

    def test_two_dimension_figures_corroborate_nothing(self, uncalibrated):
        answers = [result.answer for result in _of(uncalibrated, "two_dimensions_only")]

        assert answers and all(
            isinstance(answer, NoNumber) or answer.provenance == "printed_figure" for answer in answers
        )

    def test_whole_centimetres_alone_corroborate_nothing(self, uncalibrated):
        answers = [result.answer for result in _of(uncalibrated, "centimetres_whole")]

        assert all(isinstance(answer, NoNumber) for answer in answers)


class TestWhatTheSetFound:
    """Three cases where a number was stated that its interval did not hold, and one verdict on a wrong scale.
    Each is refused, widened or left undecided now."""

    def test_two_dimension_figures_are_enough_to_contradict_a_calibration(self, drawn):
        """A calibration at twice the true scale decided thresholds on a sheet whose two figures both disagree."""
        item = _by_name(drawn, "two_dimensions_only")
        asked = ground_truth.verdicts(item, item.truth.truths, item.calibrations(2.0))

        assert len(asked) > 40
        assert all("only 0 of the 2 dimension figures" in answer.scale.contradiction for _, _, answer in asked)
        assert {answer.outcome.verdict for _, _, answer in asked} == {"undecidable"}

    def test_two_dimension_figures_that_agree_leave_a_correct_calibration_alone(self, drawn):
        item = _by_name(drawn, "two_dimensions_only")
        asked = ground_truth.verdicts(item, item.truth.truths, item.calibrations())

        assert not any(answer.scale.contradiction for _, _, answer in asked)
        assert {"met", "not_met"} <= {answer.outcome.verdict for _, _, answer in asked}

    def test_a_view_without_dimensions_between_two_dimensioned_ones_is_not_vouched_for_by_theirs(self, uncalibrated):
        """It was read at the note's 1:100 on the strength of its neighbours' figures: 3.60 m for 1.80 m."""
        detail = _of(uncalibrated, "undimensioned_detail", "view3")

        assert len(detail) >= 80 and not any(result.stated for result in detail)
        reasons = {result.answer.reason for result in detail if result.answer.scale is not None}
        assert reasons and all("no agreeing dimension figure runs past this place" in reason for reason in reasons)

    def test_the_dimensioned_views_beside_it_are_still_measured(self, uncalibrated):
        beside = [
            result
            for view in ("view1", "view2")
            for result in _of(uncalibrated, "undimensioned_detail", view)
            if result.stated
        ]

        assert len(beside) >= 40 and all(result.holds for result in beside)

    def test_labels_all_rounded_the_same_way_widen_the_interval_to_what_they_pin(self, uncalibrated):
        """Thirteen bays of 1.254 m printed „1,25“ agree with a scale 0.8 % off; ±0.5 % was stated then."""
        stated = [
            result
            for result in _of(uncalibrated, "equal_bays_to_fit")
            if result.stated and result.answer.provenance == "vector_estimated"
        ]

        assert len(stated) >= 10 and all(result.holds for result in stated)
        errors = {round(result.answer.scale.relative_error, 4) for result in stated}
        assert errors == {0.0089}

    def test_a_printed_figure_with_a_raised_half_is_exact_to_the_half_centimetre_and_no_finer(self, uncalibrated):
        """„4,96⁵“ over a span drawn 4.967 m: the figure was stated as 4.965 ± 0.0005."""
        [printed] = [
            result.answer
            for result in _of(uncalibrated, "half_centimetre_labels")
            if result.stated and result.probe.name.endswith("along_a_dimension")
        ]

        assert printed.provenance == "printed_figure" and printed.printed.text == "4,96⁵"
        assert printed.interval == pytest.approx((4.9625, 4.9675))


class TestAVerdict:
    def test_without_a_calibration_no_threshold_is_decided_anywhere_on_the_set(self, drawn):
        asked = [row for item in drawn for row in ground_truth.verdicts(item, item.probes(), [])]

        assert len(asked) > 1000
        assert {answer.outcome.verdict for _, _, answer in asked} == {"undecidable"}

    def test_with_a_correct_calibration_every_verdict_given_is_true_of_the_drawing(self, drawn):
        decided = [
            (probe, threshold, answer)
            for item in drawn
            for probe, threshold, answer in ground_truth.verdicts(item, item.probes(), item.calibrations())
            if answer.outcome.verdict != "undecidable"
        ]

        assert len(decided) > 500
        wrong = [
            f"{probe.name}: true {probe.value:.4f} against a minimum of {threshold:.4f} is {answer.outcome.verdict}"
            for probe, threshold, answer in decided
            if ground_truth.wrong_verdict(probe, threshold, answer)
        ]
        assert not wrong, "\n".join(wrong[:40])

    def test_no_verdict_is_given_within_the_floor_of_the_true_value(self, drawn):
        item = _by_name(drawn, "note_only")
        close = [
            answer.outcome.verdict
            for probe, threshold, answer in ground_truth.verdicts(item, item.truth.truths, item.calibrations())
            if abs(threshold - probe.value) < 0.01
        ]

        assert close and set(close) == {"undecidable"}

    @pytest.mark.parametrize("factor", WRONG_CALIBRATIONS)
    def test_a_wrong_calibration_over_dimension_figures_is_contradicted_and_decides_nothing(self, drawn, factor):
        """Every dimensioned view of the set, the one in whole centimetres included: its figures corroborate no
        hint, and still fit a calibration at these factors under neither unit."""
        asked = 0
        for item in drawn:
            dimensioned = {index for index, view in enumerate(item.truth.views) if view.dimensioned}
            probes = [probe for probe in item.truth.truths if probe.region in dimensioned and not probe.refuse]
            for probe, _, answer in ground_truth.verdicts(item, probes, item.calibrations(factor)):
                asked += 1
                assert answer.scale.contradiction, f"{probe.name} at {factor}: not contradicted"
                assert answer.outcome.verdict == "undecidable", probe.name
        assert asked > 300

    def test_whole_centimetres_leave_a_correct_calibration_alone(self, drawn):
        item = _by_name(drawn, "centimetres_whole")
        asked = ground_truth.verdicts(item, item.truth.truths, item.calibrations())

        assert not any(answer.scale.contradiction for _, _, answer in asked)
        assert {"met", "not_met"} <= {answer.outcome.verdict for _, _, answer in asked}

    def test_whole_centimetres_cannot_contradict_a_calibration_ten_times_off(self, drawn):
        """What stays undetected, stated: under the other unit the figures agree with it."""
        item = _by_name(drawn, "centimetres_whole")
        asked = ground_truth.verdicts(item, item.truth.truths, item.calibrations(0.1))

        assert asked and not any(answer.scale.contradiction for _, _, answer in asked)
