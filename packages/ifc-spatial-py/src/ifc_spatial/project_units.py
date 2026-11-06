"""The project's length scale, for a file whose unit definition can be followed to its end."""

from __future__ import annotations

from typing import Any

import ifcopenshell.util.unit as uu

#: `calculate_unit_scale` follows a conversion chain with a `while` that has no
#: limit, so a chain leading back to itself never returns: not to a timeout either,
#: because the thread keeps running, holding the lock every other open waits on.
#: The BFF's IFC parser stops at the same depth (`MAX_UNIT_RESOLVE_DEPTH`).
MAX_CONVERSION_DEPTH = 16

#: The library walks the chain once per length unit in the list, so a long list of
#: a deep chain runs for hours with no loop in it. The schema allows one unit per
#: type, 84 at most in IFC4.
MAX_PROJECT_UNITS = 256


def _chain_is_too_long(unit: Any) -> bool:
    for _ in range(MAX_CONVERSION_DEPTH):
        if not unit.is_a("IfcConversionBasedUnit"):
            return False
        unit = unit.ConversionFactor.UnitComponent
    return unit.is_a("IfcConversionBasedUnit")


def _cannot_be_walked(file: Any) -> bool:
    projects = file.by_type("IfcProject")
    assignment = projects[0].UnitsInContext if projects else None
    if not assignment:
        return False
    units = assignment.Units
    return len(units) > MAX_PROJECT_UNITS or any(
        _chain_is_too_long(unit) for unit in units if getattr(unit, "UnitType", ...) == "LENGTHUNIT"
    )


def project_unit_scale(file: Any, path: str) -> float:
    from .model import ModelUnreadableError  # model.py imports this module

    if _cannot_be_walked(file):
        raise ModelUnreadableError(
            path,
            "Die Längeneinheit dieser Datei lässt sich nicht bestimmen: Die Umrechnung führt im Kreis, ist "
            "zu tief verschachtelt, oder die Datei führt zu viele Einheiten auf. Ohne Längeneinheit wäre "
            "jedes Maß falsch, deshalb wird die Datei nicht geöffnet. Das Modell bitte neu exportieren.",
        )
    return uu.calculate_unit_scale(file)
