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
_DECIMAL = re.compile(r"^(\d{1,4})[.,](\d{2,3})$")
_WHOLE = re.compile(r"^\d{1,5}$")
_LEVEL = re.compile(r"^[+\-±−]\s?\d{1,4}[.,]\d{1,3}$")
_OPENING = re.compile(r"^\d{2,4}\s?[/x×]\s?\d{2,4}$")
_SCALE = re.compile(r"(?<![\d.,])1\s?:\s?(\d{1,5})(?!\d|[.,]\d)")
_AREA = re.compile(r"\d[.,]\d+\s?(?:m²|m2|qm)\b", re.IGNORECASE)
_MAX_SCALE_NOTE_CHARS = 40
_STAMP_LEADING = 2.2


@dataclass(frozen=True)
class UnitConvention:
    name: ConventionName
    evidence: str


@dataclass(frozen=True)
class ParsedDimension:
    metres: float
    resolution: float


_RAISED_DIGITS = str.maketrans("", "", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def body_of(figure: Figure) -> str:
    return figure.text.translate(_RAISED_DIGITS) if figure.raised else figure.text


def is_numeric(figure: Figure) -> bool:
    body = body_of(figure).strip()
    return bool(_DECIMAL.match(body) or _WHOLE.match(body))


def ratios_in(text: str) -> list[int]:
    return [int(match.group(1)) for match in _SCALE.finditer(text) if int(match.group(1)) > 0]


def scale_ratios(figure: Figure) -> list[int]:
    text = figure.text.translate(_SUPERSCRIPT)
    return ratios_in(text) if len(text) <= _MAX_SCALE_NOTE_CHARS else []


def scale_ratio(figure: Figure) -> int | None:
    return next(iter(scale_ratios(figure)), None)


def is_area(figure: Figure) -> bool:
    return bool(_AREA.search(figure.text))


def classify(figure: Figure, stamp: bool = False) -> Kind:
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


def _step(unit: float, raised: str) -> float:
    if not raised:
        return unit
    return unit / 2 if raised == "5" else unit * 10.0 ** -len(raised)


def parse_dimension(figure: Figure, convention: UnitConvention) -> ParsedDimension | None:
    if convention.name == "undetermined":
        return None
    body = body_of(figure).strip()
    decimal = _DECIMAL.match(body)
    if decimal and convention.name == "metres_and_centimetres":
        digits = decimal.group(2) + figure.raised
        return ParsedDimension(
            float(f"{decimal.group(1)}.{digits}"), _step(10.0 ** -len(decimal.group(2)), figure.raised)
        )
    if _WHOLE.match(body):
        centimetres = float(f"{body}.{figure.raised}") if figure.raised else float(body)
        return ParsedDimension(centimetres / 100, _step(0.01, figure.raised))
    return None


def _stacked(above: Figure, below: Figure) -> bool:
    if above.angle != below.angle or above.angle != 0:
        return False
    gap = below.centre[1] - above.centre[1]
    overlap = min(above.box[2], below.box[2]) - max(above.box[0], below.box[0])
    return 0 < gap <= _STAMP_LEADING * max(above.height, below.height) and overlap > 0


def _blocks(figures: Sequence[Figure]) -> list[list[int]]:
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
    return [block for block in _blocks(figures) if any(is_area(figures[index]) for index in block)]
