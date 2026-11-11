"""The scale at a point of a sheet, and whether anything but a hint stands behind it.

A scale belongs to a region and is ``metres_per_point``. At a point it is
(the build specification's decision 5):

* ``verified`` when a person's calibration covers the point;
* ``estimated`` when the sheet's own dimension figures corroborate a hint: a
  region the file stores a scale for, or the one scale note the page prints.
  EVERY hint is checked, a stored region whose unit label names a unit
  included: a file plotted again at another size keeps its stored regions;
* ``uncalibrated`` otherwise, with the reason. A printed scale note alone never
  yields a number.

Corroboration is local: figures vouch for the part of the sheet they dimension
(:func:`why_not_here`), which is where an agreeing dimension runs past in two
directions. And an estimate is no finer than its figures pin the scale
(:attr:`Corroboration.pinned_error`): labels rounded to the centimetre over
short spans agree with a scale that is off by more than the tolerance. And a calibration is ``verified`` but reported as
contradicted when another calibration, its stored region, what the figures
corroborate at that place, or the figures inside its own region say otherwise.

**The corroboration check.** The unit convention is fixed for the region first
(``sheet_figures.unit_convention``), never per figure. A figure counts as a
dimension when it parses under that convention and sits on a dimension line:
the nearest segment parallel to the figure's direction, within twice the
figure's height of its centre, that ends in two terminators (or, for a chain
drawn as one long line, that carries one on each side of the figure). A
terminator is where another line meets the dimension line and stops
there: a tick, an extension line with its overshoot, or the tip of an
arrowhead. A line that crosses and runs on (the extension line of a chain
further out, a wall) ends nothing. The figure
agrees when the distance between the nearest terminator on each side, at the
hinted scale, is within :data:`AGREEMENT_TOLERANCE` of its value. No other pair
of crossings counts: on a dense sheet some pair along any line matches any
scale. The hint is corroborated when at least :data:`MIN_AGREEING` figures
agree and they are at least :data:`MIN_AGREEING_SHARE` of the region's
dimension figures.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from agent.drawings.sheet_figures import UnitConvention
from agent.drawings.sheet_figures import body_of
from agent.drawings.sheet_figures import is_numeric
from agent.drawings.sheet_figures import parse_dimension
from agent.drawings.sheet_figures import ratios_in
from agent.drawings.sheet_figures import scale_ratios
from agent.drawings.sheet_figures import unit_convention
from agent.drawings.sheet_probe import SNAP_RADIUS_PT
from agent.drawings.sheet_probe import index_of
from agent.drawings.sheet_types import Box
from agent.drawings.sheet_types import Figure
from agent.drawings.sheet_types import Point
from agent.drawings.sheet_types import Sheet
from agent.drawings.sheet_types import StoredRegion
from agent.drawings.sheet_types import inert

State = Literal["verified", "estimated", "uncalibrated"]
Source = Literal["calibration", "stored_region", "scale_note", "none"]

#: One point on paper, in metres.
METRES_PER_POINT_ON_PAPER = 0.0254 / 72
#: A figure agrees when the span at the hinted scale is within this share of its value.
AGREEMENT_TOLERANCE = 0.005
MIN_AGREEING = 3
#: The most numeric figures in one region the check looks at. Past it the region is left uncorroborated.
MAX_FIGURES_CHECKED = 2_000
MIN_AGREEING_SHARE = 0.8
#: The relative error a hint states, by where it came from (decision 10). An ``estimated`` reading carries
#: at least :data:`AGREEMENT_TOLERANCE`: the check that made it an estimate cannot tell scales apart more finely.
STORED_REGION_ERROR = 0.001
SCALE_NOTE_ERROR = 0.005
#: What a stored region's unit label may name, in metres. An empty label is read as metres and said to be assumed.
_UNIT_METRES = {"": 1.0, "m": 1.0, "cm": 0.01, "mm": 0.001}
#: A dimension line is parallel to its figure within this angle.
_PARALLEL_DEGREES = 3.0
#: A line crossing at least this steeply is a tick or an extension line; a flatter one may be an arrowhead's edge.
_CROSSING_DEGREES = 30.0
_ARROW_DEGREES = 8.0
_ON_LINE_PT = 0.5
#: A crossing line ends a dimension only when it stops within this many text heights of it (a tick's half
#: length, an extension line's overshoot); an arrowhead's edge is at most twice that long.
_TERMINATOR_REACH = 1.5
_MERGE_PT = 0.3


@dataclass(frozen=True)
class Calibration:
    """A person's calibration: a region, the scale they set in it, and the reference length they clicked."""

    box: Box
    metres_per_point: float
    reference_length_pt: float
    label: str = ""

    def __post_init__(self) -> None:
        if not (self.metres_per_point > 0 and self.reference_length_pt > 0):
            raise ValueError("a calibration needs a positive scale and a positive reference length")

    @property
    def relative_error(self) -> float:
        """One point of clicking error over the reference length (decision 10)."""
        return 1.0 / max(self.reference_length_pt, 1.0)


@dataclass(frozen=True)
class Hint:
    """A scale something on the sheet suggests, before the figures were asked."""

    source: Source
    metres_per_point: float
    box: Box
    relative_error: float
    label: str


@dataclass(frozen=True)
class FigureCheck:
    """One dimension figure against the linework: its value, the span on its dimension line, and the deviation."""

    figure: Figure
    metres: float
    span_pt: float
    deviation: float
    agrees: bool
    #: The two terminators the span lies between, on the page as shown.
    ends: tuple[Point, Point]
    #: The step the figure is printed to, in metres: its value is exact to half of it.
    resolution: float = 0.0

    @property
    def pins_within(self) -> float:
        """How far the true scale can lie from the hinted one, as a share, if this figure dimensions its span:
        its deviation and half its printed step, over the span at the hinted scale."""
        return (self.deviation + self.resolution / 2 / self.metres) / (1 - self.deviation)


@dataclass(frozen=True)
class Corroboration:
    """What the region's dimension figures say about a hint."""

    hint: Hint
    convention: UnitConvention
    checks: tuple[FigureCheck, ...]

    @property
    def agreeing(self) -> int:
        return sum(1 for check in self.checks if check.agrees)

    @property
    def corroborated(self) -> bool:
        total = len(self.checks)
        return self.agreeing >= MIN_AGREEING and self.agreeing >= MIN_AGREEING_SHARE * total

    @property
    def pinned_error(self) -> float:
        """The relative error of the hinted scale that the agreeing figures leave open.

        One figure pins the scale to its own deviation plus half the step it
        is printed to: „1,25“ over a span drawn 1.254 m agrees with a scale
        0.8 % off. The error is what the :data:`MIN_AGREEING` finest figures
        all pin it within, as many as it takes to corroborate at all.
        """
        pinned = sorted(check.pins_within for check in self.checks if check.agrees)
        return pinned[MIN_AGREEING - 1] if len(pinned) >= MIN_AGREEING else math.inf

    @property
    def why_not(self) -> str:
        if self.convention.name == "undetermined":
            return f"the figures' unit cannot be told ({self.convention.evidence})"
        if not self.checks:
            return "no dimension figure with a dimension line was found in the region"
        return (
            f"{self.agreeing} of {len(self.checks)} dimension figures agree with it; at least {MIN_AGREEING} and "
            f"{MIN_AGREEING_SHARE:.0%} of them must"
        )


@dataclass(frozen=True)
class ScaleReading:
    """The scale at a point: its state, where it comes from, and what stands behind it."""

    state: State
    metres_per_point: float | None
    box: Box
    source: Source
    label: str
    relative_error: float = 0.0
    agreeing: int = 0
    total: int = 0
    #: Why there is no scale (``uncalibrated``).
    reason: str = ""
    #: What disagrees with a person's calibration; while it is set, no verdict is given in the region.
    contradiction: str = ""

    @property
    def ratio(self) -> float | None:
        """The N of 1:N a person reads, derived for display."""
        return None if self.metres_per_point is None else display_ratio(self.metres_per_point)


def display_ratio(metres_per_point: float) -> float:
    return metres_per_point * 1000 * 72 / 25.4


def page_box(sheet: Sheet) -> Box:
    return (0.0, 0.0, sheet.width_pt, sheet.height_pt)


def contains(box: Box, point: Point) -> bool:
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def _area(box: Box) -> float:
    return (box[2] - box[0]) * (box[3] - box[1])


def region_at(sheet: Sheet, point: Point) -> StoredRegion | None:
    """The smallest stored region containing ``point``."""
    holding = [region for region in sheet.regions if contains(region.box, point)]
    return min(holding, key=lambda region: _area(region.box), default=None)


def _unit_witness(sheet: Sheet, region: StoredRegion, metres_per_point: float) -> str:
    """What else says the scale an unlabelled factor decodes to under metres: the region's own ratio text or a
    printed scale note, within one percent. Empty when nothing does."""
    decoded = display_ratio(metres_per_point)
    printed = [ratio for figure in sheet.figures for ratio in scale_ratios(figure)]
    for source, ratios in (("its ratio text", ratios_in(region.ratio)), ("a printed scale note", printed)):
        if any(abs(ratio - decoded) <= 0.01 * decoded for ratio in ratios):
            return source
    return ""


def decode_region(sheet: Sheet, region: StoredRegion) -> Hint | str:
    """The scale a stored region states, or the reason it states none this build reads.

    A factor without a unit label is read as metres only when something else
    on the sheet says the same ratio (the region's ratio text, a printed scale
    note). A file drawn in centimetres with an empty label would otherwise
    decode a hundred times too large, and figures printed in the same unit
    would agree with it.
    """
    named = f'the stored region "{region.name}"' if region.name else "the stored region"
    if region.subtype != "RL":
        return f"{named} is not a rectilinear measure (subtype {region.subtype})"
    if region.y is not None:
        return f"{named} stores a separate scale for the y axis, which is not read"
    if region.cyx is not None:
        return f"{named} stores a y-to-x factor, which is not read"
    if not region.x:
        return f"{named} stores no scale factor"
    unit, factor = region.x[0]
    metres = _UNIT_METRES.get(unit.strip().lower())
    if metres is None or factor <= 0:
        return f'{named} states its scale in "{unit}", which is not read'
    if unit.strip():
        return Hint("stored_region", factor * metres, region.box, STORED_REGION_ERROR, named)
    witness = _unit_witness(sheet, region, factor)
    if not witness:
        return f"{named} names no unit for its scale factor, and nothing else on the sheet states the same ratio"
    label = f"{named} (its unit label is empty: metres assumed, as {witness} says)"
    return Hint("stored_region", factor, region.box, STORED_REGION_ERROR, label)


def note_hint(sheet: Sheet) -> Hint | str:
    """The one scale the page prints, as a hint for the whole page, or why no note applies."""
    ratios = sorted({ratio for figure in sheet.figures for ratio in scale_ratios(figure)})
    if not ratios:
        return "the page stores no scale and prints no scale note"
    if len(ratios) > 1:
        listed = ", ".join(f"1:{ratio}" for ratio in ratios[:6]) + (", …" if len(ratios) > 6 else "")
        return f"the page prints different scale notes ({listed}) and stores no region that says where each applies"
    return Hint(
        "scale_note",
        ratios[0] * METRES_PER_POINT_ON_PAPER,
        page_box(sheet),
        SCALE_NOTE_ERROR,
        f"the printed scale note 1:{ratios[0]}",
    )


def hint_at(sheet: Sheet, point: Point) -> Hint | str:
    """The hint that applies at ``point``: its stored region, else the page's one scale note; else why none."""
    region = region_at(sheet, point)
    if region is not None:
        return decode_region(sheet, region)
    if sheet.regions:
        return "the point lies outside every region the file stores a scale for"
    return note_hint(sheet)


def _terminators(sheet: Sheet, index: int, reach: float) -> list[float]:
    """Where other lines meet segment ``index``, as distances along it from its first end, merged and sorted."""
    table = sheet.segments
    ax, ay, bx, by = table.ends(index)
    length = math.hypot(bx - ax, by - ay)
    unit = ((bx - ax) / length, (by - ay) / length)
    found: list[float] = []
    for other in index_of(sheet).near_line((ax, ay), (bx, by)):
        if other == index:
            continue
        along = _meeting(table.ends(other), bool(table.flags[other] & 2), (ax, ay), unit, length, reach)
        if along is not None:
            found.append(along)
    merged: list[float] = []
    for along in sorted(found):
        if not merged or along - merged[-1] > _MERGE_PT:
            merged.append(along)
    return merged


def _meeting(
    ends: tuple[float, float, float, float], fill_edge: bool, origin: Point, unit: Point, length: float, reach: float
) -> float | None:
    """Where a segment ends a dimension line, as a distance along it, or None when it does not.

    A stroke crossing or touching the line steeply is a tick or an extension
    line. A line END lying on it at a flat angle, from a short segment, is the
    tip of an arrowhead; a filled shape counts only by such an end (the base of
    a filled arrowhead crosses the line and is not where the dimension ends).
    """
    cx, cy, dx, dy = ends
    other_length = math.hypot(dx - cx, dy - cy)
    if other_length < 1e-9:
        return None
    cross = abs(unit[0] * (dy - cy) - unit[1] * (dx - cx)) / other_length
    degrees = math.degrees(math.asin(min(1.0, cross)))
    if degrees < _ARROW_DEGREES:
        return None
    tip = _end_on_line(ends, origin, unit, length)
    if tip is not None and (degrees >= _CROSSING_DEGREES or other_length <= 2 * reach):
        return tip
    if fill_edge or degrees < _CROSSING_DEGREES:
        return None
    crossing = _crossing_along(ends, origin, unit, length)
    return crossing if crossing is not None and _ends_near(ends, origin, unit, reach) else None


def _ends_near(ends: tuple[float, float, float, float], origin: Point, unit: Point, reach: float) -> bool:
    """Whether a crossing line stops near the dimension line: a tick, or an extension line with its overshoot.

    A line that runs on well past it on both sides is passing through: the
    extension line of another chain, a wall. It ends nothing here.
    """
    offsets = (
        abs((x - origin[0]) * unit[1] - (y - origin[1]) * unit[0]) for x, y in ((ends[0], ends[1]), (ends[2], ends[3]))
    )
    return min(offsets) <= reach


def _end_on_line(ends: tuple[float, float, float, float], origin: Point, unit: Point, length: float) -> float | None:
    """The distance along the line of an end of the segment that lies on it, or None."""
    for x, y in ((ends[0], ends[1]), (ends[2], ends[3])):
        along = (x - origin[0]) * unit[0] + (y - origin[1]) * unit[1]
        off = abs((x - origin[0]) * unit[1] - (y - origin[1]) * unit[0])
        if off <= _ON_LINE_PT and -_ON_LINE_PT <= along <= length + _ON_LINE_PT:
            return along
    return None


def _crossing_along(ends: tuple[float, float, float, float], origin: Point, unit: Point, length: float) -> float | None:
    cx, cy, dx, dy = ends
    sx, sy = dx - cx, dy - cy
    denominator = unit[0] * sy - unit[1] * sx
    along = ((cx - origin[0]) * sy - (cy - origin[1]) * sx) / denominator
    share = ((cx - origin[0]) * unit[1] - (cy - origin[1]) * unit[0]) / denominator
    slack = _ON_LINE_PT / math.hypot(sx, sy)
    if -_ON_LINE_PT <= along <= length + _ON_LINE_PT and -slack <= share <= 1 + slack:
        return along
    return None


def _line_candidates(sheet: Sheet, figure: Figure) -> list[tuple[float, int, float]]:
    """Segments that could be the figure's dimension line: ``(distance from its centre, index, centre along it)``."""
    table = sheet.segments
    reach = 2 * figure.height
    cx, cy = figure.centre
    dx, dy = figure.direction
    limit = math.sin(math.radians(_PARALLEL_DEGREES))
    found: list[tuple[float, int, float]] = []
    for index in index_of(sheet).near_box(cx - reach, cy - reach, cx + reach, cy + reach):
        ax, ay, bx, by = table.ends(index)
        length = math.hypot(bx - ax, by - ay)
        if length < figure.height or abs((bx - ax) * dy - (by - ay) * dx) > limit * length:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        off = abs((cx - ax) * uy - (cy - ay) * ux)
        along = (cx - ax) * ux + (cy - ay) * uy
        if off <= reach and 0 <= along <= length:
            found.append((off, index, along))
    return sorted(found)


def dimension_ends(sheet: Sheet, figure: Figure) -> tuple[Point, Point] | None:
    """The two terminators the figure dimensions between, on its dimension line; None when it sits on none.

    The nearest parallel line that has a terminator on both sides of the
    figure is the dimension line, and no other line is tried after it.
    """
    kept = sheet.memo.setdefault("dimension_ends", {})
    key = (figure.centre, figure.text)
    if key not in kept:
        kept[key] = _dimension_ends(sheet, figure)
    return kept[key]


def dimension_span(sheet: Sheet, figure: Figure) -> float | None:
    """The length in points the figure dimensions, or None when it sits on no dimension line."""
    ends = dimension_ends(sheet, figure)
    return None if ends is None else math.dist(*ends)


def _between_marks(marks: Sequence[float], along: float, length: float) -> tuple[float, float] | None:
    """The stretch of a line a figure at ``along`` dimensions: where it starts and ends, or None.

    A dimension drawn as its own segment ends in a terminator at each of its
    ends, and that segment is the span, whatever else crosses it on the way (a
    dimension set inside the drawing runs over walls and hatching). Only a line
    that does not end so (a chain drawn as one long line) is read by the
    nearest terminator on each side of the figure.
    """
    if not marks:
        return None
    if marks[0] <= _ON_LINE_PT and marks[-1] >= length - _ON_LINE_PT:
        return 0.0, length
    before = max((mark for mark in marks if mark <= along), default=None)
    after = min((mark for mark in marks if mark > along), default=None)
    return None if before is None or after is None else (before, after)


def _dimension_ends(sheet: Sheet, figure: Figure) -> tuple[Point, Point] | None:
    table = sheet.segments
    found: list[tuple[bool, float, tuple[Point, Point]]] = []
    for off, index, along in _line_candidates(sheet, figure):
        ax, ay, bx, by = table.ends(index)
        length = math.hypot(bx - ax, by - ay)
        stretch = _between_marks(_terminators(sheet, index, _TERMINATOR_REACH * figure.height), along, length)
        if stretch is None:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        ends = ((ax + stretch[0] * ux, ay + stretch[0] * uy), (ax + stretch[1] * ux, ay + stretch[1] * uy))
        found.append((stretch != (0.0, length), off, ends))
    # A segment that itself ends in two terminators before any that merely carries some; then the nearest.
    return min(found, key=lambda item: item[:2])[2] if found else None


def corroborate(sheet: Sheet, hint: Hint) -> Corroboration:
    """The region's dimension figures against ``hint``'s scale (the module's header defines the check)."""
    kept = sheet.memo.setdefault("corroborations", {})
    key = (hint.box, hint.metres_per_point)
    if key not in kept:
        kept[key] = _corroborate(sheet, hint)
    return kept[key]


def _corroborate(sheet: Sheet, hint: Hint) -> Corroboration:
    inside = [figure for figure in sheet.figures if contains(hint.box, figure.centre) and is_numeric(figure)]
    if len(inside) > MAX_FIGURES_CHECKED:
        # Finding each figure's dimension line costs a look at the linework around it. A region with more
        # numbers than any drawing dimensions is not checked figure by figure, and so is not corroborated.
        return Corroboration(hint, UnitConvention("undetermined", f"{len(inside):,} numbers, too many to check"), ())
    # Only a figure on a dimension line says how lengths are printed here, and only such a figure is checked.
    on_lines = [(figure, ends) for figure in inside if (ends := dimension_ends(sheet, figure)) is not None]
    convention = unit_convention(figure for figure, _ in on_lines)
    checks: list[FigureCheck] = []
    for figure, ends in on_lines:
        parsed = parse_dimension(figure, convention)
        if parsed is None or parsed.metres <= 0:
            continue
        span = math.dist(*ends)
        deviation = abs(span * hint.metres_per_point - parsed.metres) / parsed.metres
        agrees = deviation <= AGREEMENT_TOLERANCE
        checks.append(FigureCheck(figure, parsed.metres, span, deviation, agrees, ends, parsed.resolution))
    return Corroboration(hint, convention, tuple(checks))


def _to_span(point: Point, ends: tuple[Point, Point]) -> float:
    """The distance from ``point`` to the segment between ``ends``."""
    (ax, ay), (bx, by) = ends
    length_squared = (bx - ax) ** 2 + (by - ay) ** 2
    share = 0.0 if length_squared == 0 else ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / length_squared
    share = min(max(share, 0.0), 1.0)
    return math.dist((ax + share * (bx - ax), ay + share * (by - ay)), point)


def _runs_past(check: FigureCheck, point: Point) -> bool:
    """Whether ``point``'s foot on the dimension's line falls within its span, a snap radius allowed at each end."""
    (ax, ay), (bx, by) = check.ends
    length = math.dist(*check.ends)
    if length == 0:
        return False
    along = ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / length
    return -SNAP_RADIUS_PT <= along <= length + SNAP_RADIUS_PT


def _bearing(check: FigureCheck) -> int:
    """The direction of a dimension's line in whole degrees, 0 to 179."""
    (ax, ay), (bx, by) = check.ends
    return round(math.degrees(math.atan2(by - ay, bx - ax))) % 180


def _cross(first: int, second: int) -> bool:
    apart = abs(first - second)
    return min(apart, 180 - apart) >= _CROSSING_DEGREES


def why_not_here(found: Corroboration, point: Point) -> str:
    """Why a corroborated hint still says nothing at ``point``; empty when it holds there.

    Figures vouch for the part of the sheet they dimension. A second view at
    another scale under the same note or in the same stored region has its own
    figures, or none: the dimension nearest the point must be one that agrees,
    and an agreeing dimension must run past the point in two directions (its
    foot on that dimension's line falls within the span). That is the floor
    its chains dimension, and not a view beside it, between two such floors or
    below one: the extent of all agreeing dimensions, which this once was,
    held an undimensioned 1:50 view between two 1:100 ones.
    """
    nearest = min(found.checks, key=lambda check: _to_span(point, check.ends))
    if not nearest.agrees:
        return f"the dimension figure nearest this place ({inert(nearest.figure.text)}) does not agree with it"
    past = {_bearing(check) for check in found.checks if check.agrees and _runs_past(check, point)}
    if any(_cross(first, second) for first in past for second in past):
        return ""
    return "no agreeing dimension figure runs past this place in two directions: it lies outside what they dimension"


def _uncalibrated(
    sheet: Sheet, point: Point, reason: str, hint: Hint | None = None, found: Corroboration | None = None
) -> ScaleReading:
    region = region_at(sheet, point)
    box = hint.box if hint is not None else (region.box if region is not None else page_box(sheet))
    return ScaleReading(
        "uncalibrated",
        None,
        box,
        hint.source if hint is not None else "none",
        hint.label if hint is not None else "",
        agreeing=found.agreeing if found is not None else 0,
        total=len(found.checks) if found is not None else 0,
        reason=reason,
    )


def _apart(calibration: Calibration, other: float, other_error: float) -> bool:
    return abs(calibration.metres_per_point - other) / other > calibration.relative_error + other_error


def _contradiction(sheet: Sheet, calibration: Calibration, point: Point, others: Sequence[Calibration]) -> str:
    """What disagrees with a person's calibration at ``point``. Empty when nothing does.

    In turn: another calibration covering the point, the stored region there,
    what the sheet's own figures corroborate there without any calibration, and
    the dimension figures inside the calibration's own region, however few, and
    under either unit where theirs cannot be told.
    """
    said = f"the calibration says 1:{display_ratio(calibration.metres_per_point):.1f}"
    for other in others:
        if other is not calibration and _apart(calibration, other.metres_per_point, other.relative_error):
            return (
                f"{said} and another calibration covering this place says 1:{display_ratio(other.metres_per_point):.1f}"
            )
    region = region_at(sheet, point)
    stored = decode_region(sheet, region) if region is not None else None
    if isinstance(stored, Hint) and _apart(calibration, stored.metres_per_point, stored.relative_error):
        return f"{said} and {stored.label} says 1:{display_ratio(stored.metres_per_point):.1f}"
    without = scale_at(sheet, point)
    if without.state == "estimated" and _apart(calibration, without.metres_per_point, without.relative_error):
        return f"{said} and the sheet's own figures corroborate 1:{without.ratio:.1f} here ({without.label})"
    check = corroborate(sheet, Hint("calibration", calibration.metres_per_point, calibration.box, 0.0, "calibration"))
    # Any number of figures contradicts it, two included: fewer than would corroborate a hint still say "not this".
    if check.agreeing < MIN_AGREEING_SHARE * len(check.checks):
        return (
            f"only {check.agreeing} of the {len(check.checks)} dimension figures in the region agree with the "
            "calibration"
        )
    return _under_neither_unit(sheet, calibration) if check.convention.name == "undetermined" else ""


def _under_neither_unit(sheet: Sheet, calibration: Calibration) -> str:
    """What whole-number figures say against a calibration although their unit cannot be told. Empty when
    they agree with it as centimetres or as millimetres, or when there are none.

    Such figures corroborate no hint (a scale wrong by ten agrees under the other unit). They still
    contradict a calibration that fits neither reading: one at twice the true scale decided thresholds on a
    sheet dimensioned in whole centimetres.
    """
    inside = [figure for figure in sheet.figures if contains(calibration.box, figure.centre) and is_numeric(figure)]
    if len(inside) > MAX_FIGURES_CHECKED:
        return ""
    on_lines = [(float(body_of(figure)), ends) for figure in inside if (ends := dimension_ends(sheet, figure))]
    spans = [(value, math.dist(*ends) * calibration.metres_per_point) for value, ends in on_lines if value > 0]
    for unit in (0.01, 0.001):
        agreeing = sum(1 for value, metres in spans if abs(metres - value * unit) <= AGREEMENT_TOLERANCE * value * unit)
        if agreeing >= MIN_AGREEING_SHARE * len(spans):
            return ""
    return (
        f"the {len(spans)} dimension figures in the region agree with the calibration neither as centimetres nor "
        "as millimetres"
    )


def _verified(sheet: Sheet, calibration: Calibration, point: Point, covering: Sequence[Calibration]) -> ScaleReading:
    return ScaleReading(
        "verified",
        calibration.metres_per_point,
        calibration.box,
        "calibration",
        calibration.label or "a person's calibration",
        relative_error=calibration.relative_error,
        contradiction=_contradiction(sheet, calibration, point, covering),
    )


def scale_at(sheet: Sheet, point: Point, calibrations: Sequence[Calibration] = ()) -> ScaleReading:
    """The scale at ``point`` (points on the page as shown), by the rules in this module's header."""
    if sheet.user_unit != 1:
        return _uncalibrated(sheet, point, f"the page sets a user unit of {sheet.user_unit:g}, which is not handled")
    covering = [calibration for calibration in calibrations if contains(calibration.box, point)]
    if covering:
        return _verified(sheet, min(covering, key=lambda calibration: _area(calibration.box)), point, covering)
    if sheet.scan or not len(sheet.segments):
        return _uncalibrated(sheet, point, "the page has no linework to check a scale against (a scan)")
    hint = hint_at(sheet, point)
    if isinstance(hint, str):
        return _uncalibrated(sheet, point, hint)
    found = corroborate(sheet, hint)
    if not found.corroborated:
        return _uncalibrated(sheet, point, f"{hint.label} is not corroborated: {found.why_not}", hint, found)
    elsewhere = why_not_here(found, point)
    if elsewhere:
        return _uncalibrated(
            sheet, point, f"{hint.label} is corroborated elsewhere on the sheet, but {elsewhere}", hint, found
        )
    return ScaleReading(
        "estimated",
        hint.metres_per_point,
        hint.box,
        hint.source,
        hint.label,
        # The figures tell scales apart only to the agreement tolerance, and only as finely as they are printed:
        # an estimate is no finer than its check.
        relative_error=max(hint.relative_error, AGREEMENT_TOLERANCE, found.pinned_error),
        agreeing=found.agreeing,
        total=len(found.checks),
    )


def same_region(first: ScaleReading, second: ScaleReading) -> bool:
    """Whether two readings are of one region: a measurement never crosses two (decision 8)."""
    return (first.box, first.source, first.metres_per_point) == (second.box, second.source, second.metres_per_point)
