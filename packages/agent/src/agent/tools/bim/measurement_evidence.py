from __future__ import annotations

import re

EVIDENCE_PROVENANCES: frozenset[str] = frozenset({"declared", "computed"})

MEASUREMENT_EVIDENCE_PREFIX = "Messwerte in diesem Ergebnis:"

_EVIDENCE_LINE_RE = re.compile(rf"^{re.escape(MEASUREMENT_EVIDENCE_PREFIX)}\s+([1-9]\d*)\b")


def measurement_evidence_line(count: int) -> str:
    if count <= 0:
        return f"{MEASUREMENT_EVIDENCE_PREFIX} 0 — no value with provenance declared or measured."
    noun = "value" if count == 1 else "values"
    return f"{MEASUREMENT_EVIDENCE_PREFIX} {count} {noun} with provenance declared or measured."


def result_carries_measurement(content: str) -> bool:
    text = (content or "").strip()
    if not text:
        return False
    return bool(_EVIDENCE_LINE_RE.match(text.rsplit("\n", 1)[-1].strip()))
