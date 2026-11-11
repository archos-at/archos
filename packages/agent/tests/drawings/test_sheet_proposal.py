"""The calibration put to a person: offered only on a corroborated estimate, the same call each time."""

from __future__ import annotations

import math
from dataclasses import replace

from agent_testing.sheets import floor

from agent.drawings import sheet_scale
from agent.drawings.sheet_calibration import from_record
from agent.drawings.sheet_proposal import proposal_for
from agent.drawings.sheet_proposal import proposal_lines


def _reading(sheet, drawn):
    return sheet_scale.scale_at(sheet, sheet.point(drawn.share(5.0, 3.5)))


def test_an_estimated_region_offers_its_longest_agreeing_dimension_as_the_reference() -> None:
    drawn, sheet = floor()
    reading = _reading(sheet, drawn)

    proposal = proposal_for(sheet, reading, 1)

    assert reading.state == "estimated" and proposal is not None
    found = sheet_scale.corroborate(sheet, sheet_scale.hint_at(sheet, sheet.point(drawn.share(5.0, 3.5))))
    longest = max(check.span_pt for check in found.checks if check.agrees)
    reference_pt = math.dist(sheet.point(proposal.start), sheet.point(proposal.end))
    assert abs(reference_pt - longest) < 0.05  # places travel as shares rounded to five decimals
    assert (proposal.agreeing, proposal.total) == (found.agreeing, len(found.checks))


def test_accepting_the_proposal_gives_the_scale_the_sheet_was_drawn_at() -> None:
    """The reference is a printed dimension and its two ends: as a calibration it reproduces the true scale."""
    drawn, sheet = floor()
    proposal = proposal_for(sheet, _reading(sheet, drawn), 1)

    calibration = from_record(sheet, proposal.body())
    verified = sheet_scale.scale_at(sheet, sheet.point(drawn.share(5.0, 3.5)), [calibration])

    assert verified.state == "verified" and not verified.contradiction
    assert verified.ratio == pytest_approx(100.0, rel=0.005)


def test_both_ends_lie_inside_the_region_as_the_set_operation_requires() -> None:
    drawn, sheet = floor()
    proposal = proposal_for(sheet, _reading(sheet, drawn), 1)

    x, y, w, h = proposal.region
    for px, py in (proposal.start, proposal.end):
        assert x < px < x + w and y < py < y + h
    assert 0 <= x and 0 <= y and x + w <= 1.000001 and y + h <= 1.000001


def test_the_same_sheet_proposes_the_same_call_every_time() -> None:
    drawn, sheet = floor()
    first = proposal_lines(proposal_for(sheet, _reading(sheet, drawn), 1), "doc-1")
    _, again = floor()

    assert proposal_lines(proposal_for(again, _reading(again, drawn), 1), "doc-1") == first
    assert "workspace__call operation 'drawing-calibration-set'" in first[0] and '"id":"doc-1"' in first[0]


def test_a_scale_note_alone_proposes_nothing_because_no_region_there_has_an_edge() -> None:
    """A box around the agreeing dimensions could take in a neighbouring view at another scale."""
    drawn, sheet = floor(stored_region=False)
    reading = _reading(sheet, drawn)

    assert reading.state == "estimated" and reading.source == "scale_note"
    assert proposal_for(sheet, reading, 1) is None


def test_nothing_is_proposed_where_the_scale_is_not_a_corroborated_estimate() -> None:
    drawn, sheet = floor()
    reading = _reading(sheet, drawn)

    assert proposal_for(sheet, None, 1) is None
    assert proposal_for(sheet, replace(reading, state="uncalibrated", metres_per_point=None), 1) is None
    assert proposal_for(sheet, replace(reading, state="verified"), 1) is None
    # A scale the figures do not corroborate is no estimate, whatever a reading claims.
    assert proposal_for(sheet, replace(reading, metres_per_point=reading.metres_per_point * 2), 1) is None


def pytest_approx(value: float, rel: float = 1e-6):
    import pytest

    return pytest.approx(value, rel=rel)
