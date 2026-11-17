"""The project's length scale, for a file whose unit definition can be followed to its end."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import ifcopenshell.util.unit as uu

#: `calculate_unit_scale` follows the conversion chain of every length unit in the
#: list with a `while` that has no limit. A chain leading back to itself never
#: returns: not to a timeout either, because the thread keeps running, holding the
#: lock every other open waits on. A long list of deep chains runs for hours with no
#: loop in it, so the limit counts across the whole list: a step for each length unit
#: in it and for each link. The schema allows one length unit per project, so a valid
#: file only reaches it with a chain this long.
MAX_UNIT_STEPS = 1000


def _length_unit_steps(units: Any) -> Iterator[Any]:
    for unit in units:
        if getattr(unit, "UnitType", ...) != "LENGTHUNIT":
            continue
        yield unit
        while unit.is_a("IfcConversionBasedUnit"):
            unit = unit.ConversionFactor.UnitComponent
            yield unit


def _cannot_be_walked(file: Any) -> bool:
    projects = file.by_type("IfcProject")
    assignment = projects[0].UnitsInContext if projects else None
    if not assignment:
        return False
    return any(step > MAX_UNIT_STEPS for step, _ in enumerate(_length_unit_steps(assignment.Units), start=1))


def project_unit_scale(file: Any, path: str) -> float:
    from .model import ModelUnreadableError  # model.py imports this module

    if _cannot_be_walked(file):
        raise ModelUnreadableError(
            path,
            "Die Längeneinheit dieser Datei lässt sich nicht bestimmen: Die Umrechnung führt im Kreis oder nennt "
            "zu viele Einheiten. Ohne Längeneinheit wäre jedes Maß falsch, deshalb wird die Datei nicht "
            "geöffnet. Das Modell bitte neu exportieren.",
        )
    return uu.calculate_unit_scale(file)
