"""The measuring operations on a sheet: a probe or snapped points, the scale there, and the answer.

Each operation takes places as shares of the page as shown and returns a
:class:`~agent.drawings.sheet_answers.Measurement` or a
:class:`~agent.drawings.sheet_answers.NoNumber`. The order is always the same:
the engine finds the span (``sheet_probe``), the scale is read where the span
lies (``sheet_scale``), and only then is there a number, with its interval and
its verdict (``sheet_answers``).

What never yields a number: a point the engine could not tie to one piece of
linework, a span across two scale regions (decision 8), and a region whose
scale is ``uncalibrated``. In that last case a dimension figure printed on the
span is passed on as what it is, a printed figure.

The tolerance (decision 10, first version): a length carries the larger of the
widest end stroke at scale and the value times the scale's relative error; an
area twice the relative error of its lengths, and its outline's stroke.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import replace

from agent.drawings import sheet_probe
from agent.drawings.sheet_answers import CONFIRM_THE_SCALE
from agent.drawings.sheet_answers import VERDICT_FLOOR_M
from agent.drawings.sheet_answers import Answer
from agent.drawings.sheet_answers import CrossingRow
from agent.drawings.sheet_answers import Measurement
from agent.drawings.sheet_answers import NoNumber
from agent.drawings.sheet_answers import Outcome
from agent.drawings.sheet_answers import PrintedOnSpan
from agent.drawings.sheet_answers import Quantity
from agent.drawings.sheet_answers import decide
from agent.drawings.sheet_answers import provenance_of
from agent.drawings.sheet_figures import is_numeric
from agent.drawings.sheet_figures import parse_dimension
from agent.drawings.sheet_figures import unit_convention
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_scale import ScaleReading
from agent.drawings.sheet_scale import contains
from agent.drawings.sheet_scale import dimension_span
from agent.drawings.sheet_scale import same_region
from agent.drawings.sheet_scale import scale_at
from agent.drawings.sheet_types import Box
from agent.drawings.sheet_types import Figure
from agent.drawings.sheet_types import Point
from agent.drawings.sheet_types import Sheet

#: A printed figure lies on a span when its direction is within this angle of the span's.
_FIGURE_ALIGNMENT_DEGREES = 10.0
#: The most crossings one refusal lists; the indices of `between` still count them all.
MAX_CROSSINGS_LISTED = 40
_PLACE_BETTER = "place the points again, or name two of the crossings with `between`"


@dataclass(frozen=True)
class Request:
    """What every measuring operation is asked with, beside its places."""

    page: int = 1
    threshold_min: float | None = None
    threshold_max: float | None = None
    calibrations: Sequence[Calibration] = ()
    #: Whether the answer will carry the crop with the span drawn on it, for a person to check (decision 9).
    crop_attached: bool = False


def _on_page(shares: Sequence[Sequence[float]]) -> bool:
    return all(len(share) == 2 and 0 <= share[0] <= 1 and 0 <= share[1] <= 1 for share in shares)


def _off_page(request: Request) -> NoNumber:
    return NoNumber("a point is not on the page", "give every point as [x, y] shares of the page, 0 to 1", request.page)


def _rows(sheet: Sheet, crossings: Sequence[sheet_probe.Crossing]) -> tuple[CrossingRow, ...]:
    listed = enumerate(crossings[:MAX_CROSSINGS_LISTED])
    return tuple(
        CrossingRow(index, sheet.share(found.point), found.width, found.dashed, found.colour, found.fill_edge)
        for index, found in listed
    )


def _aligned(figure: Figure, start: Point, end: Point) -> bool:
    length = math.dist(start, end) or 1.0
    cross = abs(figure.direction[0] * (end[1] - start[1]) - figure.direction[1] * (end[0] - start[0])) / length
    return cross <= math.sin(math.radians(_FIGURE_ALIGNMENT_DEGREES))


@dataclass(frozen=True)
class SpanFigure:
    """A dimension figure lying on a span: the figure, its value in metres (None when the region's unit convention
    is undetermined) and the step it is printed to."""

    figure: Figure
    metres: float | None
    resolution: float


def _dimensions(sheet: Sheet, figure: Figure, start: Point, end: Point) -> bool:
    """Whether ``figure`` is the dimension OF this span: it reads along it, sits within its bounding box grown
    by the figure's height, and its own dimension line spans the same length (one point or one percent)."""
    grow = figure.height
    low_x, high_x = sorted((start[0], end[0]))
    low_y, high_y = sorted((start[1], end[1]))
    inside = low_x - grow <= figure.centre[0] <= high_x + grow and low_y - grow <= figure.centre[1] <= high_y + grow
    if not (inside and is_numeric(figure) and _aligned(figure, start, end)):
        return False
    own = dimension_span(sheet, figure)
    span = math.dist(start, end)
    return own is not None and abs(own - span) <= max(1.0, 0.01 * span)


def figure_on_span(sheet: Sheet, start: Point, end: Point, region: Box) -> SpanFigure | None:
    """The dimension figure of a span: the nearest to the span's middle when several qualify.

    It is read under the unit convention of the figures on dimension lines in
    the scale region the span lies in. A figure that merely lies near the span
    and dimensions something else is not its figure.
    """
    middle = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    lying = [figure for figure in sheet.figures if _dimensions(sheet, figure, start, end)]
    if not lying:
        return None
    figure = min(lying, key=lambda candidate: math.dist(candidate.centre, middle))
    on_lines = [
        other
        for other in sheet.figures
        if contains(region, other.centre) and is_numeric(other) and dimension_span(sheet, other) is not None
    ]
    parsed = parse_dimension(figure, unit_convention(on_lines))
    return SpanFigure(figure, parsed.metres if parsed else None, parsed.resolution if parsed else 0.0)


def _printed(found: SpanFigure | None, sheet: Sheet, value: float | None, tolerance: float) -> PrintedOnSpan | None:
    if found is None:
        return None
    compared = value is not None and found.metres is not None
    agrees = abs(found.metres - value) <= max(tolerance, found.resolution / 2) if compared else None
    return PrintedOnSpan(found.figure.text, found.metres, sheet.share(found.figure.centre), agrees)


#: How many places along each leg the scale is read at, its ends included.
_SAMPLES_PER_LEG = 9


def _along(points: Sequence[Point], closed: bool) -> list[Point]:
    """The points and evenly spaced places on every leg between them: a leg can pass over a region its ends miss."""
    legs = list(zip(points, [*points[1:], points[0]] if closed else points[1:], strict=False))
    steps = _SAMPLES_PER_LEG - 1
    places = [
        (a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps)
        for a, b in legs
        for step in range(steps + 1)
    ]
    return places or list(points)


def _one_scale(
    sheet: Sheet, points: Sequence[Point], request: Request, closed: bool = False
) -> ScaleReading | NoNumber:
    """The scale the whole measurement lies in, or the refusal naming the two regions it touches (decision 8)."""
    readings = [scale_at(sheet, place, request.calibrations) for place in _along(points, closed)]
    apart = next((reading for reading in readings[1:] if not same_region(readings[0], reading)), None)
    if apart is None:
        return readings[0]
    first, second = (reading.label or reading.reason or "no region" for reading in (readings[0], apart))
    return NoNumber(
        f"the measurement touches two scale regions ({first}; {second})",
        "measure inside one region: a measurement never crosses two",
        request.page,
    )


def _printed_answer(
    found: SpanFigure, sheet: Sheet, points: Sequence[Point], scale: ScaleReading, request: Request
) -> Measurement:
    """The answer of an uncalibrated region that prints a dimension on the span: the figure, never a measurement."""
    half = found.resolution / 2
    answer = Measurement(
        "clearance",
        found.metres,
        "m",
        (found.metres - half, found.metres + half),
        "printed_figure",
        request.page,
        tuple(sheet.share(point) for point in points),
        scale,
        printed=_printed(found, sheet, None, 0.0),
        notes=(f"The linework was not measured here: {scale.reason}.",),
    )
    outcome = decide(answer, request.threshold_min, request.threshold_max, crop_attached=request.crop_attached)
    return replace(answer, outcome=outcome)


def _unscaled(sheet: Sheet, points: Sequence[Point], scale: ScaleReading, request: Request, span: bool) -> Answer:
    found = figure_on_span(sheet, points[0], points[-1], scale.box) if span else None
    if found is not None and found.metres is not None:
        return _printed_answer(found, sheet, points, scale, request)
    reason = f"this region has no usable scale ({scale.reason})"
    return NoNumber(reason, CONFIRM_THE_SCALE, request.page, scale, printed=_printed(found, sheet, None, 0.0))


_AS_DRAWN = "Between linework as drawn: the engine does not tell a structural face from a finished one."


def _length_answer(
    quantity: Quantity,
    sheet: Sheet,
    points: Sequence[Point],
    moved: Sequence[float],
    stroke_pt: float,
    inside: int,
    request: Request,
    notes: tuple[str, ...] = (),
) -> Answer:
    """A length between places the engine fixed, at the scale they share: the number, its interval and verdict."""
    scale = _one_scale(sheet, points, request)
    if isinstance(scale, NoNumber):
        return scale
    span = len(points) == 2
    if scale.metres_per_point is None:
        return _unscaled(sheet, points, scale, request, span)
    value = sheet_probe.polyline_length(points) * scale.metres_per_point
    # Never finer than the widest end stroke, nor than the distance two lines are told apart at.
    tolerance = max(max(stroke_pt, sheet_probe.MERGE_PT) * scale.metres_per_point, value * scale.relative_error)
    answer = Measurement(
        quantity,
        value,
        "m",
        (value - tolerance, value + tolerance),
        provenance_of(scale),
        request.page,
        tuple(sheet.share(point) for point in points),
        scale,
        moved_pt=tuple(moved),
        inside=inside,
        printed=_printed(figure_on_span(sheet, *points, scale.box), sheet, value, tolerance) if span else None,
        notes=(_AS_DRAWN, *notes),
    )
    outcome = decide(answer, request.threshold_min, request.threshold_max, crop_attached=request.crop_attached)
    return replace(answer, outcome=outcome)


def clearance(
    sheet: Sheet, start: Sequence[float], end: Sequence[float], request: Request, between: Sequence[int] | None = None
) -> Answer:
    """The clear width between the two faces the points were placed near (decision 9)."""
    if not _on_page((start, end)):
        return _off_page(request)
    found = sheet_probe.clearance(sheet, sheet.point(start), sheet.point(end), between)
    if isinstance(found, sheet_probe.Undecided):
        more = len(found.crossings) - MAX_CROSSINGS_LISTED
        tail = f" ({more} more crossings are not listed: place the points closer to the faces)" if more > 0 else ""
        return NoNumber(
            f"the engine could not pick the span: {found.reason}{tail}",
            _PLACE_BETTER,
            request.page,
            crossings=_rows(sheet, found.crossings),
        )
    dashed = ("Note: a line this span ends on is dashed (hidden, overhead or planned, by the sheet's legend).",)
    notes = dashed if found.start.dashed or found.end.dashed else ()
    answer = _length_answer(
        "clearance", sheet, found.points, found.moved, found.widest_stroke_pt, found.inside, request, notes
    )
    if found.askew_degrees <= sheet_probe.PARALLEL_DEGREES or not isinstance(answer, Measurement):
        return answer
    return _askew(answer, found.askew_degrees, request)


def _askew(answer: Measurement, degrees: float, request: Request) -> Measurement:
    """A span between two lines that are not parallel: the width depends on where it is taken, so no verdict."""
    why = (
        f"the two lines are not parallel ({degrees:.1f} degrees apart): this is the distance along the line "
        "between the two points, and the width differs along the lines"
    )
    asked = request.threshold_min is not None or request.threshold_max is not None
    reasons = (*(answer.outcome.reasons if answer.outcome else ()), why)
    outcome = Outcome("undecidable", reasons) if asked else None
    return replace(answer, outcome=outcome, notes=(*answer.notes, f"Note: {why}."))


def _snapped(sheet: Sheet, shares: Sequence[Sequence[float]], request: Request) -> list[sheet_probe.Snapped] | NoNumber:
    """Every point moved to its one line end or intersection, or the refusal for the first that has none or two."""
    snapped: list[sheet_probe.Snapped] = []
    for number, share in enumerate(shares, start=1):
        found = sheet_probe.snap(sheet, sheet.point(share))
        if isinstance(found, sheet_probe.Unsnapped):
            return NoNumber(
                f"point {number} could not be tied to the drawing: {found.reason}",
                "place the point on a line end or corner, or on one of the candidates listed",
                request.page,
                candidates=tuple(sheet.share(place) for place in found.candidates[:MAX_CROSSINGS_LISTED]),
            )
        snapped.append(found)
    return snapped


def distance(sheet: Sheet, start: Sequence[float], end: Sequence[float], request: Request) -> Answer:
    """The straight distance between two points, each moved to the one line end or corner in reach."""
    return path(sheet, (start, end), request, quantity="distance")


def path(sheet: Sheet, shares: Sequence[Sequence[float]], request: Request, quantity: Quantity = "path") -> Answer:
    """The length of the path through the points, each moved to the one line end or corner in reach."""
    if len(shares) < 2:
        return NoNumber("a path needs two points", "pass at least two", request.page)
    if not _on_page(shares):
        return _off_page(request)
    snapped = _snapped(sheet, shares, request)
    if isinstance(snapped, NoNumber):
        return snapped
    points = [found.point for found in snapped]
    if sheet_probe.polyline_length(points) < sheet_probe.MERGE_PT:
        return NoNumber("the points are the same place", "place them apart", request.page)
    stroke = max(found.width for found in snapped)
    inside = sum(_strictly_inside(sheet, a, b) for a, b in zip(points, points[1:], strict=False))
    return _length_answer(quantity, sheet, points, [found.moved for found in snapped], stroke, inside, request)


def _strictly_inside(sheet: Sheet, start: Point, end: Point) -> int:
    """How many lines cross the straight line between two snapped points, the lines at its ends not counted."""
    length = math.dist(start, end)
    found = sheet_probe.crossings(sheet, start, end)
    return sum(1 for crossing in found if sheet_probe.MERGE_PT < crossing.along < length - sheet_probe.MERGE_PT)


def area(sheet: Sheet, shares: Sequence[Sequence[float]], request: Request) -> Answer:
    """The area the points enclose, each moved to the one line end or corner in reach."""
    if len(shares) < 3:
        return NoNumber("an area needs three points", "pass the corners in order", request.page)
    if not _on_page(shares):
        return _off_page(request)
    snapped = _snapped(sheet, shares, request)
    if isinstance(snapped, NoNumber):
        return snapped
    points = [found.point for found in snapped]
    if not sheet_probe.is_simple(points) or sheet_probe.polygon_area(points) < sheet_probe.MERGE_PT:
        return NoNumber(
            "the corners do not enclose an area: the outline through them crosses itself or is flat",
            "pass the corners in order around the outline",
            request.page,
        )
    scale = _one_scale(sheet, points, request, closed=True)
    if isinstance(scale, NoNumber):
        return scale
    if scale.metres_per_point is None:
        return _unscaled(sheet, points, scale, request, span=False)
    metres = scale.metres_per_point
    value = sheet_probe.polygon_area(points) * metres * metres
    outline = sheet_probe.polyline_length([*points, points[0]]) * metres
    stroke = max(found.width for found in snapped) * metres
    tolerance = min(max(2 * scale.relative_error * value, outline * stroke), value)
    answer = Measurement(
        "area",
        value,
        "m2",
        (value - tolerance, value + tolerance),
        provenance_of(scale),
        request.page,
        tuple(sheet.share(point) for point in points),
        scale,
        moved_pt=tuple(found.moved for found in snapped),
        notes=("The area of the corners as placed on linework: no rule for what counts as floor area is applied.",),
    )
    floor = VERDICT_FLOOR_M * outline
    outcome = decide(
        answer, request.threshold_min, request.threshold_max, crop_attached=request.crop_attached, floor=floor
    )
    return replace(answer, outcome=outcome)
