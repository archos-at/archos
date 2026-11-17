from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from typing import Any

CAUSES: dict[str, str] = {
    "wrong_value": "The answer states a wrong number, class or requirement, or misread a table or the project's facts.",
    "wrong_rule": (
        "The answer used the wrong regulation: another Land's law, an outdated edition, an OIB-Richtlinie where "
        "a Bauordnung applies, or the wrong Punkt or §."
    ),
    "incomplete": (
        "The answer is right as far as it goes but leaves out a case, a threshold, an exception or a requirement "
        "that matters."
    ),
    "misunderstood": (
        "The answer addresses a different question than the one asked (another building type, use, element or "
        "situation)."
    ),
    "no_source": "The answer gives no source, or a source the reader cannot check.",
    "not_found": (
        "The assistant did not find or could not open a document the reader has "
        "(a project file, a Bescheid, a drawing)."
    ),
    "form": (
        "The content may be right but the form is the problem: too long, unclear, badly structured, a table that "
        "does not help."
    ),
    "slow": "The answer took too long — also when the reader only picked the reason 'too_slow' and wrote nothing.",
    "broken": "The answer is cut off, empty, garbled or shows an error.",
    "other": "None of the above, or no way to tell from what was written.",
}

CAUSE_THRESHOLD = 0.8
SLOT = "feedback_causes"
CAUSE_QUESTION = (
    "Why did the reader rate this answer as unhelpful? Read the comment first, then the reason they "
    "picked and the question."
)
_MAX_TEXT = 300


def _state(sample: Any) -> dict[str, str]:
    state = {"question": str(getattr(sample, "question", "") or "")[:_MAX_TEXT]}
    if getattr(sample, "reason", None):
        state["reason"] = str(sample.reason)
    if getattr(sample, "comment", None):
        state["comment"] = str(sample.comment)[:_MAX_TEXT]
    return state


async def label_causes(samples: Sequence[Any], *, organization_id: str | None = None) -> list[str | None]:
    if not samples:
        return []
    from agent.common.decisions import choice
    from agent.common.decisions import decide_many

    decided = await decide_many(
        [_state(sample) for sample in samples],
        {"cause": choice(CAUSE_QUESTION, CAUSES)},
        slot=SLOT,
        organization_id=organization_id,
    )
    labels: list[str | None] = []
    for decision in decided:
        cause, distribution = decision.choice("cause") if decision is not None else (None, {})
        labels.append(cause if cause in CAUSES and distribution.get(cause, 0.0) >= CAUSE_THRESHOLD else None)
    return labels


def count_causes(labels: Sequence[str | None]) -> dict[str, int]:
    return dict(Counter(label for label in labels if label).most_common())
