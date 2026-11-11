"""The reading operations on a sheet: what it is, what is printed on it, its room stamps, and its scale check.

None of these needs a scale, and none computes a number: they return what the
file holds. Lines of printed text are a document's own words, so each listing
keeps them apart from the words written here (:class:`Listing`), and the tool
puts them inside the fence quoted text sits in.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from agent.drawings import sheet_figures
from agent.drawings import sheet_scale
from agent.drawings.sheet_figures import Kind
from agent.drawings.sheet_scale import Calibration
from agent.drawings.sheet_scale import ScaleReading
from agent.drawings.sheet_types import Box
from agent.drawings.sheet_types import Figure
from agent.drawings.sheet_types import Sheet

#: The most regions one `sheet` answer lists, and the most figures one `scale_check` names per side.
MAX_REGIONS = 24
MAX_CHECKED = 12
#: A printed line is listed up to this many characters, and a room stamp up to this many lines: a listing of
#: 200 rows stays an answer a model can read whatever the file's text layer holds.
MAX_PRINTED_CHARS = 120
MAX_STAMP_LINES = 8


@dataclass(frozen=True)
class Listing:
    """An answer of a reading operation: ``head`` is this module's words, ``quoted`` the sheet's own lines."""

    head: tuple[str, ...]
    quoted: tuple[str, ...] = ()


def _printed(figure: Figure) -> str:
    """A figure's text as one bounded line. It still goes inside the fence: it is the file's own words."""
    line = " ".join(figure.text.split())
    return line if len(line) <= MAX_PRINTED_CHARS else line[: MAX_PRINTED_CHARS - 1] + "…"


def _place(sheet: Sheet, figure: Figure) -> str:
    x, y = sheet.share(figure.centre)
    turned = f" | {figure.angle}°" if figure.angle else ""
    return f"x={x:.4f} y={y:.4f}{turned}"


def _box(sheet: Sheet, box: Box) -> str:
    x, y, w, h = sheet.share_box(box)
    return f"[{x:.4f}, {y:.4f}, {w:.4f}, {h:.4f}]"


def scale_line(reading: ScaleReading) -> str:
    """One scale reading as a sentence: its ratio, state and what stands behind it, or why there is none."""
    if reading.metres_per_point is None:
        return f"uncalibrated ({reading.reason})"
    behind = f"; {reading.agreeing} of {reading.total} dimension figures agree" if reading.state == "estimated" else ""
    warned = f"; CONTRADICTED: {reading.contradiction}" if reading.contradiction else ""
    return f"1:{reading.ratio:.4g}, {reading.state}, from {reading.label}{behind}{warned}"


def _region_rows(sheet: Sheet, calibrations: Sequence[Calibration]) -> list[str]:
    """One row per region a scale belongs to: every calibration, every stored region, else the page."""
    boxes = [calibration.box for calibration in calibrations] + [region.box for region in sheet.regions]
    boxes = list(dict.fromkeys(boxes)) or [sheet_scale.page_box(sheet)]
    rows = []
    for box in boxes[:MAX_REGIONS]:
        centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        rows.append(f"  region {_box(sheet, box)}: {scale_line(sheet_scale.scale_at(sheet, centre, calibrations))}")
    if len(boxes) > MAX_REGIONS:
        rows.append(f"  ({len(boxes) - MAX_REGIONS} more regions are not listed)")
    return rows


def overview(sheet: Sheet, calibrations: Sequence[Calibration] = ()) -> Listing:
    """``sheet``: size, format, rotation, whether it is a scan, each region's scale, and the unit convention."""
    named = f" ({sheet.format})" if sheet.format else ""
    turned = f", shown turned by {sheet.rotation}°" if sheet.rotation else ""
    convention = sheet_figures.unit_convention(sheet.figures)
    head = [
        f"Sheet: {sheet.width_mm:.0f} x {sheet.height_mm:.0f} mm{named}{turned}.",
        f"Linework: {len(sheet.segments):,} segments. Printed text: {len(sheet.figures):,} figures.",
    ]
    if sheet.scan:
        head.append("This page is a scan: an image with no linework. Nothing can be measured on it; read it with look.")
    elif not sheet.figures:
        head.append("The page has no text layer: its lettering is drawn as linework, so no figure can be read.")
    head.append("Scale by region (shares of the page as [x, y, w, h]):")
    head.extend(_region_rows(sheet, calibrations))
    head.append(f"Unit convention of the figures (an inference): {convention.name}; {convention.evidence}.")
    return Listing(tuple(head))


def _in_region(sheet: Sheet, figures: Sequence[Figure], region: Sequence[float] | None) -> list[Figure]:
    if region is None:
        return list(figures)
    x0, y0 = sheet.point((region[0], region[1]))
    x1, y1 = sheet.point((region[0] + region[2], region[1] + region[3]))
    return [figure for figure in figures if x0 <= figure.centre[0] <= x1 and y0 <= figure.centre[1] <= y1]


def figures(
    sheet: Sheet, region: Sequence[float] | None = None, query: str = "", kind: Kind | None = None, limit: int = 50
) -> Listing:
    """``figures``: the printed figures in ``region``, filtered by a substring or a kind, bounded by ``limit``."""
    stamped = {index for block in sheet_figures.room_stamps(sheet.figures) for index in block}
    kinds = [sheet_figures.classify(figure, index in stamped) for index, figure in enumerate(sheet.figures)]
    wanted = {id(figure) for figure in _in_region(sheet, sheet.figures, region)}
    needle = query.strip().lower()
    found = [
        (figure, found_kind)
        for figure, found_kind in zip(sheet.figures, kinds, strict=True)
        if id(figure) in wanted and (kind is None or found_kind == kind) and needle in figure.text.lower()
    ]
    if not found:
        return Listing(("No printed figure matches.",))
    shown = found[:limit]
    cut = (
        f" {len(shown)} of {len(found)} are listed: narrow the region, the query or the kind."
        if len(shown) < len(found)
        else ""
    )
    head = f"Printed figures, as printed (text | kind | centre as shares of the page | direction).{cut}"
    return Listing(
        (head,), tuple(f"{_printed(figure)} | {found_kind} | {_place(sheet, figure)}" for figure, found_kind in shown)
    )


def rooms(sheet: Sheet, limit: int = 50) -> Listing:
    """``rooms``: the room stamps of the page, each as its printed lines with its place. Nothing is computed."""
    stamps = sheet_figures.room_stamps(sheet.figures)
    if not stamps:
        return Listing(("No room stamp was found: no block of printed lines holds an area.",))
    shown = stamps[:limit]
    cut = f" {len(shown)} of {len(stamps)} are listed." if len(shown) < len(stamps) else ""
    lines = []
    for block in shown:
        first = sheet.figures[block[0]]
        printed = " / ".join(_printed(sheet.figures[index]) for index in block[:MAX_STAMP_LINES])
        lines.append(f"{printed} | {_place(sheet, first)}")
    head = (
        f"Room stamps, as printed (lines top to bottom | place of the first line). Printed values, not measured.{cut}"
    )
    return Listing((head,), tuple(lines))


def _checked(sheet: Sheet, checks: Sequence[sheet_scale.FigureCheck], scale: float) -> list[str]:
    rows = [
        f"{_printed(check.figure)} | {_place(sheet, check.figure)} | drawn {check.span_pt * scale:.3f} m "
        f"({check.deviation:.2%})"
        for check in checks[:MAX_CHECKED]
    ]
    if len(checks) > MAX_CHECKED:
        rows.append(f"({len(checks) - MAX_CHECKED} more)")
    return rows


def _hints(sheet: Sheet, region: Sequence[float] | None) -> list[sheet_scale.Hint | str]:
    """The hint that applies in ``region``; without one, every stored region's, else the page's scale note."""
    if region is not None:
        return [sheet_scale.hint_at(sheet, sheet.point((region[0] + region[2] / 2, region[1] + region[3] / 2)))]
    if sheet.regions:
        return [sheet_scale.decode_region(sheet, stored) for stored in sheet.regions[:MAX_REGIONS]]
    return [sheet_scale.note_hint(sheet)]


def _hint_check(sheet: Sheet, hint: sheet_scale.Hint | str) -> Listing:
    if isinstance(hint, str):
        return Listing((f"No scale hint applies: {hint}.",))
    found = sheet_scale.corroborate(sheet, hint)
    verdict = "corroborated" if found.corroborated else f"NOT corroborated ({found.why_not})"
    ratio = sheet_scale.display_ratio(hint.metres_per_point)
    head = [
        f"Hint: 1:{ratio:.4g} from {hint.label}, region {_box(sheet, hint.box)}.",
        f"Unit convention (an inference): {found.convention.name}; {found.convention.evidence}.",
        f"Result: {verdict}. {found.agreeing} of {len(found.checks)} dimension figures agree within "
        f"{sheet_scale.AGREEMENT_TOLERANCE:.1%}.",
    ]
    agree = [check for check in found.checks if check.agrees]
    differ = [check for check in found.checks if not check.agrees]
    quoted = [*_checked(sheet, differ, hint.metres_per_point), *_checked(sheet, agree, hint.metres_per_point)]
    if quoted:
        head.append(f"Figures (text | place | span drawn at the hinted scale): the {len(differ)} that differ first.")
    return Listing(tuple(head), tuple(quoted))


def scale_check(sheet: Sheet, region: Sequence[float] | None = None) -> tuple[Listing, ...]:
    """``scale_check``: each hint that applies against its region's own dimension figures."""
    return tuple(_hint_check(sheet, hint) for hint in _hints(sheet, region))
