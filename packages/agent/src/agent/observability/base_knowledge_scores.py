"""The scores the office's base knowledge produces (ADR-0163), declared into ``SCORE_DEFINITIONS``.

Its own module, spread into ``SCORE_DEFINITIONS`` with one line, so the list
does not grow with every part that declares scores. The builder is pure: the
turn's answer-label records in, a count out, emitted by ``turn.context`` when
the turn context is loaded.
"""

from __future__ import annotations

from collections.abc import Sequence

from .golden_scores import GOLDEN_SCORE_DEFINITIONS
from .law_source_scores import LAW_SOURCE_SCORE_DEFINITIONS
from .onboarding_scores import ONBOARDING_SCORE_DEFINITIONS
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
    # The country onboarding tooling's (ADR-0174): the platform's base knowledge, kept in its own module.
    *ONBOARDING_SCORE_DEFINITIONS,
    # A country's quality bar (ADR-0165 amendment): the golden run's scores and the six citation scores.
    *GOLDEN_SCORE_DEFINITIONS,
    # Whether law was cited from its own source (the web screen and the binding-claim check).
    *LAW_SOURCE_SCORE_DEFINITIONS,
)


def overdue_count(labels: Sequence[dict[str, object]]) -> float:
    """How many answer-label records say their copy's check is overdue. Pure."""
    return float(sum(1 for label in labels if label.get("checkOverdue") is True))
