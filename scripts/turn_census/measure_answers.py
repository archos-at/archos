from __future__ import annotations

import re
from typing import Any

UNITS = ("m", "m2")
KEYS = frozenset({"probe", "truth", "unit", "within", "or_no_number"})
_NUMBER = r"(?<![\d.,:])(\d{1,5}(?:[.,]\d{1,4})?)"
_LENGTH = re.compile(_NUMBER + r"\s?(mm|cm|m)(?![\w²])")
_AREA = re.compile(_NUMBER + r"\s?(?:m²|m2|qm)(?!\w)")
_METRES = {"mm": 0.001, "cm": 0.01, "m": 1.0}


def validate(row_id: str, measure: Any) -> None:
    if not isinstance(measure, dict) or not set(measure) <= KEYS:
        raise ValueError(f"{row_id}: measure takes {', '.join(sorted(KEYS))}")
    if measure.get("unit") not in UNITS:
        raise ValueError(f"{row_id}: measure.unit must be one of {', '.join(UNITS)}")
    if not (float(measure.get("truth") or 0) > 0 and float(measure.get("within") or 0) > 0):
        raise ValueError(f"{row_id}: measure needs a positive truth and a positive within")


def stated(answer: str, unit: str) -> list[float]:
    if unit == "m2":
        return [float(number.replace(",", ".")) for number in _AREA.findall(answer)]
    return [float(number.replace(",", ".")) * _METRES[suffix] for number, suffix in _LENGTH.findall(answer)]


def measure_check(measure: dict[str, Any], answer: str) -> bool:
    values = stated(answer, measure["unit"])
    if values:
        return any(abs(value - float(measure["truth"])) <= float(measure["within"]) for value in values)
    folded = answer.casefold()
    return any(str(phrase).casefold() in folded for phrase in measure.get("or_no_number") or [])
