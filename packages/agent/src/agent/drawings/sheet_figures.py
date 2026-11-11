"""What a printed figure is, by its form: a dimension, a level mark, an opening size, a scale note, a room stamp.

The reader returns figures as printed (``knowledge_layer.sheet.figures``); this
module reads their FORM and nothing of the linework. Whether a figure that
looks like a dimension IS one (it sits on a dimension line) is the scale
check's question (``sheet_scale``).

**The unit convention is an inference, stated with its evidence.** A sheet
prints „2,385“ or „238⁵“ or „2385“ for the same length. The convention is fixed
once for a region, from the forms of the figures that sit on a dimension line
there (the caller passes only those: a room number „1.05“ says nothing about
how lengths are printed), before any figure is compared with the linework, and
never per figure:

* decimal figures present: decimals are metres and whole numbers centimetres
  (the mixed convention of construction drawings);
* no decimals, but whole numbers with a raised final digit: centimetres;
* whole numbers only, nothing raised: **undetermined**. Centimetres and
  millimetres differ by ten, and a scale wrong by ten would then agree with the
  figures under the other reading, so no reading is assumed.

A raised final digit is half of the last printed unit where it is a 5, and in
general the next decimal: „2,38⁵“ is 2.385 m, „238⁵“ is 238.5 cm.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from agent.drawings.sheet_types import Figure

Kind = Literal["dimension", "level_mark", "opening_size", "scale_note", "room_stamp", "other"]
KINDS: tuple[Kind, ...] = ("dimension", "level_mark", "opening_size", "scale_note", "room_stamp", "other")
ConventionName = Literal["metres_and_centimetres", "centimetres", "undetermined"]

_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
# Two or three decimals: a length in metres is printed to the centimetre or the millimetre. One decimal
# („400,0“, „2,5“) is as often centimetres, a slope or a room number, and is read as nothing.
_DECIMAL = re.compile(r"^(\d{1,4})[.,](\d{2,3})$")
_WHOLE = re.compile(r"^\d{1,5}$")
_LEVEL = re.compile(r"^[+\-±−]\s?\d{1,4}[.,]\d{1,3}$")
_OPENING = re.compile(r"^\d{2,4}\s?[/x×]\s?\d{2,4}$")
_SCALE = re.compile(r"(?<![\d.,])1\s?:\s?(\d{1,5})(?!\d|[.,]\d)")
_AREA = re.compile(r"\d[.,]\d+\s?(?:m²|m2|qm)\b", re.IGNORECASE)
_MAX_SCALE_NOTE_CHARS = 40
#: Lines of one room stamp sit at most this many text heights apart, baseline to baseline.
_STAMP_LEADING = 2.2


@dataclass(frozen=True)
class UnitConvention:
    """How a region's dimension figures are read, and what in the region says so."""

    name: ConventionName
    evidence: str


@dataclass(frozen=True)
class ParsedDimension:
    """A dimension figure's value in metres and the size of its last printed digit, in metres."""

    metres: float
    resolution: float


_RAISED_DIGITS = str.maketrans("", "", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def body_of(figure: Figure) -> str:
    """The figure's text without its raised digit, which the reader writes as a superscript where it stands."""
    return figure.text.translate(_RAISED_DIGITS) if figure.raised else figure.text


def is_numeric(figure: Figure) -> bool:
    """Whether the figure has the form of a dimension: a decimal or a whole number, nothing else."""
    body = body_of(figure).strip()
    return bool(_DECIMAL.match(body) or _WHOLE.match(body))


def ratios_in(text: str) -> list[int]:
    """Every N of a „1:N“ in ``text``, in order."""
    return [int(match.group(1)) for match in _SCALE.finditer(text) if int(match.group(1)) > 0]


def scale_ratios(figure: Figure) -> list[int]:
    """Every N a figure prints as „1:N“. A long sentence that happens to hold one is not a scale note."""
    text = figure.text.translate(_SUPERSCRIPT)
    return ratios_in(text) if len(text) <= _MAX_SCALE_NOTE_CHARS else []


def scale_ratio(figure: Figure) -> int | None:
    """The first N of a printed „1:N“, or None."""
    return next(iter(scale_ratios(figure)), None)


def is_area(figure: Figure) -> bool:
    return bool(_AREA.search(figure.text))


def classify(figure: Figure, stamp: bool = False) -> Kind:
    """The figure's kind by form; ``stamp`` says it is a line of a room stamp (:func:`room_stamps`)."""
    text = figure.text.strip()
    if stamp:
        return "room_stamp"
    if scale_ratio(figure) is not None:
        return "scale_note"
    if _LEVEL.match(text):
        return "level_mark"
    if _OPENING.match(text):
        return "opening_size"
    if is_numeric(figure):
        return "dimension"
    return "other"


def unit_convention(figures: Iterable[Figure]) -> UnitConvention:
    """The convention a region's numeric figures are read under, with the counts that decide it."""
    numeric = [figure for figure in figures if is_numeric(figure)]
    decimals = sum(1 for figure in numeric if _DECIMAL.match(body_of(figure).strip()))
    whole = len(numeric) - decimals
    raised_whole = sum(1 for figure in numeric if figure.raised and _WHOLE.match(body_of(figure).strip()))
    if decimals:
        return UnitConvention(
            "metres_and_centimetres",
            f"{decimals} decimal figures read as metres, {whole} whole numbers read as centimetres",
        )
    if raised_whole:
        return UnitConvention(
            "centimetres", f"{whole} whole numbers, {raised_whole} with a raised final digit: read as centimetres"
        )
    return UnitConvention(
        "undetermined",
        f"{whole} whole numbers and no decimal or raised digit: centimetres and millimetres cannot be told apart",
    )


def parse_dimension(figure: Figure, convention: UnitConvention) -> ParsedDimension | None:
    """The figure's length under ``convention``, or None when its form does not parse under it."""
    if convention.name == "undetermined":
        return None
    body = body_of(figure).strip()
    decimal = _DECIMAL.match(body)
    if decimal and convention.name == "metres_and_centimetres":
        digits = decimal.group(2) + figure.raised
        return ParsedDimension(float(f"{decimal.group(1)}.{digits}"), 10.0 ** -len(digits))
    if _WHOLE.match(body):
        centimetres = float(f"{body}.{figure.raised}") if figure.raised else float(body)
        return ParsedDimension(centimetres / 100, 0.01 * 10.0 ** -len(figure.raised))
    return None


def _stacked(above: Figure, below: Figure) -> bool:
    """Whether ``below`` is the next line of the block ``above`` is in: same direction, close under it, overlapping."""
    if above.angle != below.angle or above.angle != 0:
        return False
    gap = below.centre[1] - above.centre[1]
    overlap = min(above.box[2], below.box[2]) - max(above.box[0], below.box[0])
    return 0 < gap <= _STAMP_LEADING * max(above.height, below.height) and overlap > 0


def _blocks(figures: Sequence[Figure]) -> list[list[int]]:
    """Upright figures grouped into text blocks: each line under the line before it. Indices into ``figures``.

    Figures are taken top to bottom; only the blocks whose last line is still
    close above can take the next one, so a sheet of ten thousand figures looks
    at a handful per figure and not at every block before it.
    """
    order = sorted(range(len(figures)), key=lambda index: (figures[index].centre[1], figures[index].centre[0]))
    blocks: list[list[int]] = []
    open_blocks: list[list[int]] = []
    for index in order:
        figure = figures[index]
        reach = _STAMP_LEADING * 2 * figure.height
        open_blocks = [block for block in open_blocks if figure.centre[1] - figures[block[-1]].centre[1] <= reach]
        home = next((block for block in open_blocks if _stacked(figures[block[-1]], figure)), None)
        if home is None:
            home = []
            blocks.append(home)
            open_blocks.append(home)
        home.append(index)
    return blocks


def room_stamps(figures: Sequence[Figure]) -> list[list[int]]:
    """The room stamps among ``figures``: blocks of lines of which one is a printed area. Indices, top line first.

    It reads what is printed and computes nothing: a stamp is its lines.
    """
    return [block for block in _blocks(figures) if any(is_area(figures[index]) for index in block)]
