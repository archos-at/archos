"""What a measurement on a sheet answers with, and the one function that renders it.

A number never leaves without what it rests on: a :class:`Measurement` cannot
be constructed without its provenance and its interval, and the interval must
hold the value. The other answer, :class:`NoNumber`, is as much an answer:
„undecidable, confirm the scale“ is what a sheet that cannot be relied on gets.

``provenance`` says where the value came from:

* ``vector_verified``: the linework, at a scale a person calibrated;
* ``vector_estimated``: the linework, at a scale the file hints at and the
  sheet's own dimension figures corroborate. A length with a caveat, never a
  verdict;
* ``printed_figure``: no measurement at all, the value a dimension figure on
  the span prints.

A verdict against a threshold is ``met``, ``not_met`` or ``undecidable``
(:func:`decide`). Only a person's uncontradicted calibration can yield the
first two, and then only when nothing lies inside the span and a printed figure
agrees or the answer carries the crop for a person to look at.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from agent.drawings.sheet_scale import ScaleReading

Provenance = Literal["printed_figure", "vector_verified", "vector_estimated"]
PROVENANCES: tuple[Provenance, ...] = ("printed_figure", "vector_verified", "vector_estimated")
Verdict = Literal["met", "not_met", "undecidable"]
Quantity = Literal["clearance", "distance", "path", "area"]

#: A threshold this close to the value is undecidable whatever the interval: the face a width is
#: measured to (structural, finished) is unknown to centimetres. Provisional until measured on real sheets.
VERDICT_FLOOR_M = 0.02

CONFIRM_THE_SCALE = "ask a person to confirm the scale of this region (a calibration), then measure again"


_PROVENANCE_OF_STATE: dict[str, Provenance] = {"verified": "vector_verified", "estimated": "vector_estimated"}


def provenance_of(scale: ScaleReading) -> Provenance:
    """The provenance of a value measured at ``scale``."""
    return _PROVENANCE_OF_STATE[scale.state]


@dataclass(frozen=True)
class PrintedOnSpan:
    """A printed figure lying on the measured span, and whether it agrees with the measurement."""

    text: str
    metres: float | None
    place: tuple[float, float]
    agrees: bool | None


@dataclass(frozen=True)
class Outcome:
    """A verdict against the thresholds passed, and every reason it is not firmer."""

    verdict: Verdict
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class Measurement:
    """One number with what it rests on. Places are shares of the page as shown."""

    quantity: Quantity
    value: float
    unit: Literal["m", "m2"]
    interval: tuple[float, float]
    provenance: Provenance
    page: int
    points: tuple[tuple[float, float], ...]
    scale: ScaleReading
    moved_pt: tuple[float, ...] = ()
    inside: int = 0
    printed: PrintedOnSpan | None = None
    outcome: Outcome | None = None
    notes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.provenance not in PROVENANCES:
            raise ValueError(f"a measurement needs a provenance, one of {', '.join(PROVENANCES)}")
        low, high = self.interval
        if not low <= self.value <= high:
            raise ValueError("a measurement needs an interval that holds its value")
        if self.provenance == "printed_figure":
            return
        if self.scale.metres_per_point is None or self.scale.metres_per_point <= 0:
            raise ValueError("a measured value needs a scale")
        # The provenance is the scale's state, said once: a value cannot call itself verified over a hint.
        if _PROVENANCE_OF_STATE.get(self.scale.state) != self.provenance:
            raise ValueError(f"provenance {self.provenance} does not match a scale that is {self.scale.state}")


@dataclass(frozen=True)
class CrossingRow:
    """One crossing along a probe, as the caller is shown it."""

    index: int
    place: tuple[float, float]
    width_pt: float
    dashed: bool
    colour: int
    fill_edge: bool


@dataclass(frozen=True)
class NoNumber:
    """No number, and why: the reason, the remedy, and what the caller can choose from."""

    reason: str
    remedy: str
    page: int
    scale: ScaleReading | None = None
    crossings: tuple[CrossingRow, ...] = ()
    candidates: tuple[tuple[float, float], ...] = ()
    printed: PrintedOnSpan | None = None


Answer = Measurement | NoNumber


def _threshold_reasons(value: float, interval: tuple[float, float], floor: float, bounds: Sequence[float]) -> list[str]:
    reasons: list[str] = []
    for bound in bounds:
        if abs(value - bound) <= floor:
            reasons.append(f"the value is within {floor:.2f} of the threshold {bound:g}")
        elif interval[0] < bound < interval[1]:
            reasons.append(f"the threshold {bound:g} lies inside the value's interval")
    return reasons


def decide(
    measurement: Measurement,
    threshold_min: float | None,
    threshold_max: float | None,
    *,
    crop_attached: bool,
    floor: float = VERDICT_FLOOR_M,
) -> Outcome | None:
    """The verdict of ``measurement`` against the thresholds, or None when none was passed.

    ``met`` and ``not_met`` need all of: a person's calibration nothing on the
    sheet contradicts, no linework crossing inside the span, a printed figure
    on the span that agrees or the crop carried for a person
    (``crop_attached``), and the thresholds clear of the value's interval and
    of ``floor``. Anything less is ``undecidable`` with each reason.
    """
    bounds = [bound for bound in (threshold_min, threshold_max) if bound is not None]
    if not bounds:
        return None
    reasons: list[str] = []
    scale = measurement.scale
    if measurement.provenance != "vector_verified":
        reasons.append(f"the scale is {scale.state}, not verified by a person: {CONFIRM_THE_SCALE}")
    if scale.contradiction:
        reasons.append(f"the calibration is contradicted ({scale.contradiction}): a person has to look")
    if measurement.inside:
        reasons.append(f"{measurement.inside} lines cross the span between its ends")
    agreeing = measurement.printed is not None and measurement.printed.agrees is True
    if measurement.printed is not None and measurement.printed.agrees is False:
        reasons.append(f"the printed figure {measurement.printed.text} on the span disagrees with the measurement")
    elif not agreeing and not crop_attached:
        reasons.append("no printed figure on the span agrees and the answer carries no crop for a person to check")
    reasons.extend(_threshold_reasons(measurement.value, measurement.interval, floor, bounds))
    if reasons:
        return Outcome("undecidable", tuple(reasons))
    low, high = measurement.interval
    above = threshold_min is None or low >= threshold_min
    below = threshold_max is None or high <= threshold_max
    return Outcome("met" if above and below else "not_met")


def _number(value: float, unit: str) -> str:
    return f"{value:.3f} {'m²' if unit == 'm2' else 'm'}"


def _scale_line(scale: ScaleReading) -> str:
    if scale.metres_per_point is None:
        return f"Scale: uncalibrated. {scale.reason[:1].upper()}{scale.reason[1:]}."
    behind = f", {scale.agreeing} of {scale.total} dimension figures agree" if scale.state == "estimated" else ""
    warned = f" CONTRADICTED: {scale.contradiction}." if scale.contradiction else ""
    return f"Scale: 1:{scale.ratio:.4g} ({scale.state}; from {scale.label}{behind}).{warned}"


def _points_line(points: Sequence[tuple[float, float]]) -> str:
    return " -> ".join(f"[{x:.5f}, {y:.5f}]" for x, y in points)


_WHAT = {
    "vector_verified": "measured between linework as drawn, at a scale a person calibrated",
    "vector_estimated": (
        "measured between linework as drawn, at an ESTIMATED scale: state it with that caveat, and decide no "
        "threshold from it"
    ),
    "printed_figure": "NOT measured: the value a dimension figure on the span prints",
}


def _measurement_lines(answer: Measurement) -> list[str]:
    low, high = answer.interval
    unit = answer.unit
    lines = [
        f"{answer.quantity}: {_number(answer.value, unit)} (interval {_number(low, unit)} to {_number(high, unit)})",
        f"Provenance: {answer.provenance} ({_WHAT[answer.provenance]}).",
        f"Place: page {answer.page}, {_points_line(answer.points)} (shares of the page).",
        _scale_line(answer.scale),
    ]
    if answer.moved_pt:
        moved = ", ".join(f"{distance:.1f}" for distance in answer.moved_pt)
        lines.append(f"Each point was moved to linework by {moved} pt; {answer.inside} lines cross the span inside.")
    if answer.printed is not None:
        agrees = {True: "agrees", False: "DISAGREES", None: "not compared"}[answer.printed.agrees]
        lines.append(f"Printed figure on the span: {answer.printed.text} ({agrees}).")
    if answer.outcome is not None:
        lines.append(f"Verdict: {answer.outcome.verdict}." + "".join(f"\n  - {r}" for r in answer.outcome.reasons))
    lines.extend(answer.notes)
    return lines


def _no_number_lines(answer: NoNumber) -> list[str]:
    lines = [f"No number: {answer.reason}.", f"Remedy: {answer.remedy}."]
    if answer.scale is not None:
        lines.append(_scale_line(answer.scale))
    if answer.printed is not None:
        lines.append(f"Printed figure on the span (not measured): {answer.printed.text}.")
    for row in answer.crossings:
        style = ", ".join(
            filter(
                None, (f"{row.width_pt:.2f} pt", "dashed" if row.dashed else "", "fill edge" if row.fill_edge else "")
            )
        )
        lines.append(f"  crossing {row.index}: [{row.place[0]:.5f}, {row.place[1]:.5f}] ({style}, #{row.colour:06x})")
    lines.extend(f"  candidate: [{x:.5f}, {y:.5f}]" for x, y in answer.candidates)
    return lines


def render(answer: Answer) -> str:
    """The answer as the text a model reads: every line a fact of the answer, none added."""
    lines = _measurement_lines(answer) if isinstance(answer, Measurement) else _no_number_lines(answer)
    return "\n".join(lines)
