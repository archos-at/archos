"""The calibration the tool proposes, held to the ground-truth set.

A person who accepts the card makes its region ``verified``, and a verdict can follow. So on every sheet of
the set, including the ones that say something false about themselves: whatever calibration is proposed
anywhere on the sheet, once accepted, must leave no number outside its interval and no verdict that is not
true of the drawing.
"""

from __future__ import annotations

import pytest
from agent_testing import ground_truth
from agent_testing.ground_truth import Drawn
from agent_testing.ground_truth import Result
from agent_testing.ground_truth import describe

from agent.drawings.sheet_calibration import from_record
from agent.drawings.sheet_measure import Request
from agent.drawings.sheet_proposal import proposal_for
from agent.drawings.sheet_scale import Calibration


@pytest.fixture(scope="module")
def drawn() -> list[Drawn]:
    return ground_truth.read_set()


def _proposed(item: Drawn) -> list[Calibration]:
    """Every distinct calibration the tool would propose on an answer to any probe of the sheet."""
    bodies: dict[str, dict] = {}
    for probe in item.truth.truths:
        answer = ground_truth.ask(item.sheet, probe, Request())
        proposal = proposal_for(item.sheet, answer.scale, 1)
        if proposal is not None:
            bodies[repr(proposal.body())] = proposal.body()
    return [from_record(item.sheet, body) for body in bodies.values()]


@pytest.fixture(scope="module")
def accepted(drawn) -> list[tuple[Drawn, list[Calibration]]]:
    return [(item, _proposed(item)) for item in drawn]


def test_the_set_gets_proposals_at_all(accepted) -> None:
    """The gate below is not passed by proposing nothing."""
    offered = [item.truth.name for item, calibrations in accepted if calibrations]

    assert len(offered) >= 3, offered


def test_no_proposal_is_made_on_a_sheet_whose_stated_scale_is_false(accepted) -> None:
    false = {item.truth.name for item, calibrations in accepted if calibrations and not item.truth.hint_is_true}

    assert not false


def test_an_accepted_proposal_states_no_number_whose_true_value_lies_outside_its_interval(accepted) -> None:
    failures = []
    for item, calibrations in accepted:
        for calibration in calibrations:
            request = Request(calibrations=[calibration])
            for probe in item.probes():
                result = Result(item.truth.name, probe, True, ground_truth.ask(item.sheet, probe, request))
                if result.stated and not result.holds:
                    failures.append(result)

    assert not failures, "\n".join(describe(failure) for failure in failures[:40])


def test_an_accepted_proposal_gives_no_verdict_that_is_not_true_of_the_drawing(accepted) -> None:
    wrong = [
        (item.truth.name, probe.name, threshold, answer.outcome.verdict)
        for item, calibrations in accepted
        for calibration in calibrations
        for probe, threshold, answer in ground_truth.verdicts(item, item.truth.truths, [calibration])
        if ground_truth.wrong_verdict(probe, threshold, answer)
    ]

    assert not wrong, wrong[:20]
