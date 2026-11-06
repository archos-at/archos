"""The project's length scale, for a file whose unit definition can be followed to its end."""

from __future__ import annotations

from typing import Any

import ifcopenshell.util.unit as uu

#: `calculate_unit_scale` follows the conversion chain of every length unit in the
#: list with a `while` that has no limit. A chain leading back to itself never
#: returns: not to a timeout either, because the thread keeps running, holding the
#: lock every other open waits on. A long list of deep chains runs for hours with no
#: loop in it, so the limit counts links across the whole list. The schema allows one
#: length unit per project, so a valid file only reaches it with a chain this long.
MAX_CONVERSION_LINKS = 1000


def _cannot_be_walked(file: Any) -> bool:
    projects = file.by_type("IfcProject")
    assignment = projects[0].UnitsInContext if projects else None
    if not assignment:
        return False
    links = 0
    for unit in assignment.Units:
        if getattr(unit, "UnitType", ...) != "LENGTHUNIT":
            continue
        while unit.is_a("IfcConversionBasedUnit"):
            links += 1
            if links > MAX_CONVERSION_LINKS:
                return True
            unit = unit.ConversionFactor.UnitComponent
    return False


def project_unit_scale(file: Any, path: str) -> float:
    from .model import ModelUnreadableError  # model.py imports this module

    if _cannot_be_walked(file):
        raise ModelUnreadableError(
            path,
            "Die Längeneinheit dieser Datei lässt sich nicht bestimmen: Die Umrechnung führt im Kreis oder ist "
            "zu tief verschachtelt. Ohne Längeneinheit wäre jedes Maß falsch, deshalb wird die Datei nicht "
            "geöffnet. Das Modell bitte neu exportieren.",
        )
    return uu.calculate_unit_scale(file)
