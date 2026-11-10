"""The scores the office's base knowledge produces (ADR-0163), declared into ``SCORE_DEFINITIONS``.

Its own module, spread into ``SCORE_DEFINITIONS`` with one line, so the list
does not grow with every part that declares scores. The builder is pure: the
turn's answer-label records in, a count out, emitted by ``turn.context`` when
the turn context is loaded.
"""

from __future__ import annotations

from collections.abc import Sequence

from .score_definition import ScoreDefinition

BASE_KNOWLEDGE_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="base-knowledge-overdue",
        data_type="NUMERIC",
        description=(
            "On a turn that carried the office's base knowledge (ADR-0163): how many of its confirmed copies were "
            "overdue for a check (365 days, 180 for a directive, or a check that found a problem). Zero is a "
            "measurement. Each one is a copy the answer must say is stale when it rests on it."
        ),
        min_value=0,
    ),
)


def overdue_count(labels: Sequence[dict[str, object]]) -> float:
    """How many answer-label records say their copy's check is overdue. Pure."""
    return float(sum(1 for label in labels if label.get("checkOverdue") is True))
