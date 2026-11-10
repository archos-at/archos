"""The office base knowledge's score (ADR-0163): overdue copies a turn carried."""

from __future__ import annotations

from agent.observability.base_knowledge_scores import BASE_KNOWLEDGE_SCORE_DEFINITIONS
from agent.observability.base_knowledge_scores import overdue_count
from agent.observability.langfuse_scores import SCORE_DEFINITIONS


def test_it_counts_the_overdue_copies_and_zero_is_a_measurement():
    labels = [{"checkOverdue": True}, {"checkOverdue": False}, {"checkOverdue": True}, {}]
    assert overdue_count(labels) == 2.0
    assert overdue_count([]) == 0.0


def test_its_definitions_are_in_the_one_list():
    assert set(BASE_KNOWLEDGE_SCORE_DEFINITIONS) <= set(SCORE_DEFINITIONS)
