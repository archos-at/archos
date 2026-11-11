"""What a measuring question accepts as an answer: the visual eval's ``expect.measure``.

A row that asks for a length or an area on a drawing cannot be scored by ``mentions``: the right answer is
a number NEAR the true value, and on a sheet whose scale nothing confirms the right answer is no number at
all. So a row states the truth and the two acceptable forms::

    measure:
      probe: note_only/view1/room_a_width   # the ground-truth probe the question is about
      truth: 4.0                            # metres, or square metres
      unit: m                               # m | m2
      within: 0.02                          # how far a stated number may lie from the truth
      or_no_number: ["Maßstab", "kalibr"]   # optional: no number of that unit, and one of these said

The check holds when the answer states a value of that unit within ``within`` of the truth. It also holds,
where the row has ``or_no_number``, when the answer states NO value of that unit and says one of the
phrases („bitte den Maßstab bestätigen“). An answer that states values of the unit and none near the truth
fails: a wrong number said plainly is the failure this set exists for. What it cannot see: a right number
beside a wrong one passes, and it reads the prose, not the interval the tool returned.

``truth`` and ``within`` are held to the ground-truth set by ``tests/test_visual_eval.py``: the probe's
drawn value, and at least the half interval the engine states for it.
"""

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
    """Refuse a ``measure`` this reader would misread: an unknown key or unit, or no positive truth and reach."""
    if not isinstance(measure, dict) or not set(measure) <= KEYS:
        raise ValueError(f"{row_id}: measure takes {', '.join(sorted(KEYS))}")
    if measure.get("unit") not in UNITS:
        raise ValueError(f"{row_id}: measure.unit must be one of {', '.join(UNITS)}")
    if not (float(measure.get("truth") or 0) > 0 and float(measure.get("within") or 0) > 0):
        raise ValueError(f"{row_id}: measure needs a positive truth and a positive within")


def stated(answer: str, unit: str) -> list[float]:
    """Every value of ``unit`` the answer states, in metres or square metres. „1:50“ is no length."""
    if unit == "m2":
        return [float(number.replace(",", ".")) for number in _AREA.findall(answer)]
    return [float(number.replace(",", ".")) * _METRES[suffix] for number, suffix in _LENGTH.findall(answer)]


def measure_check(measure: dict[str, Any], answer: str) -> bool:
    """Whether ``answer`` is one of the forms the row accepts (the module's header says which)."""
    values = stated(answer, measure["unit"])
    if values:
        return any(abs(value - float(measure["truth"])) <= float(measure["within"]) for value in values)
    folded = answer.casefold()
    return any(str(phrase).casefold() in folded for phrase in measure.get("or_no_number") or [])
