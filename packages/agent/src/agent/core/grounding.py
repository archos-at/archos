"""Whether a tool result is a MEASUREMENT of the building: the signal a measured answer carries.

An IFC measurement has no passage to cite. It carries something else instead,
and arguably something stronger: a ``provenance`` (declared/computed/inferred),
an absolute ``tolerance``, a ``method`` string a reviewer can read back, and the
GlobalIds the value was derived from (``ifc_spatial.envelope.Answer``). It is
REPRODUCIBLE, which no quotation is. The tools node records that a turn
measured (``answer_measurement_grounded``) and the answer check reads the
measured values beside the passages (``common/claim_judge.py``, ADR-0139).

What used to follow here, a German net for statements about the law that kept a
measurement from grounding a legal verdict, went with the confidence rules it
served: the check is told that a measurement never backs a statement about what
a regulation requires, and reads the answer itself.

## The invariant this must not break

The measurement layer MEASURES; the Bestimmung JUDGES. No operator returns a
verdict, a threshold, „erfüllt" or a Gebäudeklasse. Nothing here may create a
route by which a measurement's evidence attaches itself to a judgment.
"""

from __future__ import annotations

from agent.common.tool_calls import tool_basename
from agent.tools.bim.measurement_evidence import result_carries_measurement

MEASUREMENT_TOOL_NAMES: frozenset[str] = frozenset({"ifc_measure"})

_TOOL_ERROR_PREFIX = "error:"


def tool_result_is_measurement(tool_name: str, content: str) -> bool:
    """Whether one tool result is a MEASUREMENT of the building.

    True only for a result from a tool in :data:`MEASUREMENT_TOOL_NAMES` whose
    own evidence trailer reports at least one ``declared``/``computed`` value
    (:mod:`agent.tools.bim.measurement_evidence`). A refusal, an outage, an
    ``inferred`` guess, and a ``decidable: false`` finding about the export are
    all False — none of them is a number anyone can stand behind, and treating
    them as evidence is the failure this whole gate exists to prevent.

    It reads the renderer's stated COUNT rather than searching the result for
    „gemessen"/„deklariert", because the renderer uses those verbs in prose that
    explains why nothing could be measured — „gemessen: raumhoehe an 0 von 3
    Bauteilen", „…dessen Höhe gemessen werden könnte". Under the old vocabulary
    match every one of those refusals granted grounding.
    """
    if tool_basename(tool_name) not in MEASUREMENT_TOOL_NAMES:
        return False
    text = (content or "").strip()
    if not text or text[: len(_TOOL_ERROR_PREFIX)].lower() == _TOOL_ERROR_PREFIX:
        return False
    return result_carries_measurement(text)
