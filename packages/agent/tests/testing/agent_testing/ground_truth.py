"""The ground-truth set run through the measuring engine: every probe asked as the tool asks it, and what came back.

``knowledge_layer_testing.ground_truth_sheets`` draws the sheets and knows the
true value of every probe. This module reads each sheet as the tool reads it,
asks ``sheet_measure`` with a :class:`~agent.drawings.sheet_measure.Request`,
and says of each answer whether it states a number and whether the truth lies
in the interval it states. The release gate's test and the counting script
(``scripts/drawing_ground_truth_report.py``) both stand on it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import replace

from knowledge_layer_testing.ground_truth_sheets import TruthSheet
from knowledge_layer_testing.ground_truth_sheets import ground_truth_set
from knowledge_layer_testing.ground_truth_sheets import jittered
from knowledge_layer_testing.ground_truth_views import Truth

from agent.drawings import sheet_measure
from agent.drawings.sheet_answers import Answer
from agent.drawings.sheet_answers import Measurement
from agent.drawings.sheet_measure import Request
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_types import Sheet
from agent_testing.sheets import sheet_of

#: How far a placed point is moved, in points, and how often, when the set is asked with an unsteady hand.
JITTER_PT = (1.0, 2.0)
JITTER_COPIES = 3
JITTER_SEED = 20261111
#: Thresholds asked of every probe, as distances from its true value (metres; square metres for an area).
THRESHOLD_OFFSETS = (-0.5, -0.1, -0.03, -0.005, 0.005, 0.03, 0.1, 0.5)


@dataclass(frozen=True)
class Drawn:
    """A sheet of the set and the same sheet read back from its PDF."""

    truth: TruthSheet
    sheet: Sheet

    def fresh(self) -> Drawn:
        """The same sheet with nothing remembered: what a changed constant needs."""
        return replace(self, sheet=replace(self.sheet, memo={}))

    def probes(self) -> list[Truth]:
        """The sheet's probes as placed, then each again with every point moved a little (seeded)."""
        moved = [
            probe
            for index, radius in enumerate(JITTER_PT)
            for probe in jittered(self.truth, radius, JITTER_COPIES, JITTER_SEED + index)
        ]
        return [*self.truth.truths, *moved]

    def calibrations(self, factor: float = 1.0) -> list[Calibration]:
        """A person's calibration of every view, each at ``factor`` of the view's true scale."""
        return [
            Calibration(region.box, region.metres_per_point * factor, region.reference_pt, "a person's calibration")
            for region in self.truth.regions
        ]


def read_set() -> list[Drawn]:
    """Every sheet of the set, written as a PDF and read back through the reader."""
    return [Drawn(truth, sheet_of(truth.page)) for truth in ground_truth_set()]


def ask(sheet: Sheet, probe: Truth, request: Request) -> Answer:
    """The probe asked through the function the tool calls for its operation."""
    if probe.operation == "clearance":
        return sheet_measure.clearance(sheet, *probe.places, request)
    if probe.operation == "distance":
        return sheet_measure.distance(sheet, *probe.places, request)
    if probe.operation == "path":
        return sheet_measure.path(sheet, probe.places, request)
    return sheet_measure.area(sheet, probe.places, request)


@dataclass(frozen=True)
class Result:
    """One probe asked once: the sheet, the probe, whether a person's calibration was passed, and the answer."""

    sheet: str
    probe: Truth
    calibrated: bool
    answer: Answer

    @property
    def stated(self) -> bool:
        return isinstance(self.answer, Measurement)

    @property
    def holds(self) -> bool:
        """Whether a stated number's interval holds the true value. A probe with no true value holds nothing."""
        if not isinstance(self.answer, Measurement) or self.probe.refuse:
            return False
        low, high = self.answer.interval
        return low <= self.probe.value <= high

    @property
    def share_of_interval(self) -> float | None:
        """|measured − true| over the half interval stated; None without a number or a true value."""
        if not isinstance(self.answer, Measurement) or self.probe.refuse:
            return None
        half = (self.answer.interval[1] - self.answer.interval[0]) / 2
        off = abs(self.answer.value - self.probe.value)
        return off / half if half > 0 else (0.0 if off == 0 else float("inf"))

    @property
    def refusal(self) -> str:
        """The reason no number was stated, with its numbers and names taken out: what a count groups by."""
        return "" if self.stated else refusal_group(self.answer.reason)


_GROUPS: tuple[tuple[str, str], ...] = (
    (r"touches two scale regions", "touches two scale regions"),
    (r"too many to tell its corners apart", "point not tied: too many lines in reach (hatching)"),
    (r"line ends or intersections within reach", "point not tied: several line ends in reach"),
    (r"no line end or intersection", "point not tied: nothing in reach"),
    (r"meets a line at", "span not picked: a line met too flat"),
    (r"lines within reach of it", "span not picked: several lines in reach of an end"),
    (r"no linework within reach", "span not picked: no line in reach of an end"),
    (r"both points reach the same line", "span not picked: both ends reach one line"),
    (r"unit cannot be told", "no scale: the figures' unit cannot be told"),
    (r"is corroborated elsewhere", "no scale: the hint is corroborated elsewhere, not here"),
    (r"is not corroborated", "no scale: the hint is not corroborated by the figures"),
    (r"outside every region", "no scale: outside every stored region"),
    (r"no usable scale", "no scale: other"),
)


def refusal_group(reason: str) -> str:
    return next((group for pattern, group in _GROUPS if re.search(pattern, reason)), f"other: {reason[:60]}")


def run(drawn: Iterable[Drawn], calibrated: bool, probes: Sequence[Truth] | None = None) -> list[Result]:
    """Every probe of every sheet asked once, with or without a correct calibration of each view."""
    results: list[Result] = []
    for item in drawn:
        request = Request(calibrations=item.calibrations() if calibrated else ())
        for probe in probes if probes is not None else item.probes():
            results.append(Result(item.truth.name, probe, calibrated, ask(item.sheet, probe, request)))
    return results


def outside(results: Iterable[Result]) -> list[Result]:
    """The answers that state a number whose true value is not in the interval stated: the release gate's failures."""
    return [result for result in results if result.stated and not result.holds]


def describe(result: Result) -> str:
    """One failing answer as a line: what was asked, what was true, what was stated."""
    answer = result.answer
    low, high = answer.interval
    scale = answer.scale
    true = "no true value" if result.probe.refuse else f"true {result.probe.value:.4f}"
    return (
        f"{result.probe.name} ({'calibrated' if result.calibrated else 'uncalibrated'}): {true}, stated "
        f"{answer.value:.4f} [{low:.4f}, {high:.4f}] {answer.provenance}, scale {scale.state} from "
        f"{scale.label or scale.reason}"
    )


def verdicts(
    item: Drawn, probes: Sequence[Truth], calibrations: Sequence[Calibration]
) -> list[tuple[Truth, float, Measurement]]:
    """Every probe asked against a minimum at each of :data:`THRESHOLD_OFFSETS` from its true value, the crop
    carried: ``(probe, threshold, answer)`` for each answer that states a number."""
    found = []
    for probe in probes:
        for threshold in (probe.value + offset for offset in THRESHOLD_OFFSETS if probe.value + offset > 0):
            request = Request(threshold_min=threshold, calibrations=calibrations, crop_attached=True)
            answer = ask(item.sheet, probe, request)
            if isinstance(answer, Measurement) and not probe.refuse:
                found.append((probe, threshold, answer))
    return found


def wrong_verdict(probe: Truth, threshold: float, answer: Measurement) -> bool:
    """Whether a verdict was given that is not true of the drawing: ``met`` under the minimum, or the reverse."""
    verdict = answer.outcome.verdict
    return verdict != "undecidable" and (verdict == "met") != (probe.value >= threshold)
