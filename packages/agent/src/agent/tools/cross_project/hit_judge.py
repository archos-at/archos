from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

SLOT = "reference_hits"

PASSAGE_CHARS = 600

# Measured 10 Oct 2026 (19 questions, 184 passages): all 22 evidence passages scored 0.8 or more, so 0.5 never fired the page-on hint beside an answer.
SOLVED_THRESHOLD = 0.5

# Measured: 7 of 7 planted instructions flagged, none of 184 real passages.
INJECTION_THRESHOLD = 0.70

SOLVED_QUESTION = {
    "type": "noul",
    "instructions": (
        "The question was asked in a building project; the passage comes from an earlier project of the same "
        "office. Does the passage show how a comparable case was solved or decided there: a construction or "
        "detail that was built, a deviation and how it was justified, a Gutachten's result, or a condition or "
        "demand the building authority set?"
    ),
    "criteria": {
        "true": (
            "The passage states what was built, decided, demanded or accepted for the subject the question is "
            "about, so it can serve as a precedent."
        ),
        "false": (
            "The passage only names the subject, describes something else, is general text, a table of "
            "contents or an administrative note, or concerns another element or problem."
        ),
    },
}


@dataclass(frozen=True)
class HitVerdicts:

    solved: tuple[float | None, ...]
    injection: tuple[float | None, ...]

    @property
    def any_solved(self) -> bool:
        return any(p is not None and p >= SOLVED_THRESHOLD for p in self.solved)

    @property
    def all_judged(self) -> bool:
        return all(p is not None for p in self.solved)

    @property
    def flagged(self) -> tuple[int, ...]:
        return tuple(i for i, p in enumerate(self.injection) if p is not None and p >= INJECTION_THRESHOLD)

    def order(self) -> list[int]:
        judged = sorted(
            (i for i, p in enumerate(self.solved) if p is not None), key=lambda i: (-(self.solved[i] or 0.0), i)
        )
        return [*judged, *(i for i, p in enumerate(self.solved) if p is None)]


def hit_state(query: str, hit: dict[str, Any]) -> dict[str, Any]:
    project = hit.get("project") if isinstance(hit.get("project"), dict) else {}
    return {
        "question": query[:500],
        "passage": {
            "project": str(project.get("name") or ""),
            "source": str(hit.get("filename") or ""),
            "text": str(hit.get("snippet") or "")[:PASSAGE_CHARS],
        },
        "language": "de",
    }


async def judge_hits(query: str, hits: Sequence[dict[str, Any]]) -> HitVerdicts | None:
    from agent.common.decisions import decide_many

    if not hits or not query.strip():
        return None
    try:
        from knowledge_layer.search import INJECTION_QUESTION
    except ImportError:  # pragma: no cover - the layer ships with the agent
        INJECTION_QUESTION = None  # noqa: N806
    questions: dict[str, Any] = {"solved": SOLVED_QUESTION}
    if INJECTION_QUESTION is not None:
        questions["injection"] = INJECTION_QUESTION
    decided = await decide_many([hit_state(query, hit) for hit in hits], questions, slot=SLOT)
    if not any(decision is not None for decision in decided):
        return None
    return HitVerdicts(
        solved=tuple(decision.noul("solved") if decision else None for decision in decided),
        injection=tuple(decision.noul("injection") if decision else None for decision in decided),
    )
