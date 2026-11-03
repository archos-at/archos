"""The orchestrator switch: the claim queue unless a tier says otherwise, and never a guess."""

from __future__ import annotations

import pytest

from agent.common import hatchet_client
from agent.common.hatchet_client import Orchestrator
from agent.common.hatchet_client import Tier
from agent.common.hatchet_client import orchestrator


@pytest.mark.parametrize("tier", list(Tier))
def test_a_tier_runs_on_the_claim_queue_until_its_flag_says_otherwise(monkeypatch, tier):
    monkeypatch.delenv(f"{tier.value}_ORCHESTRATOR", raising=False)
    assert orchestrator(tier) is Orchestrator.CLAIM_QUEUE


def test_the_flag_is_read_per_tier_and_case_insensitively(monkeypatch):
    monkeypatch.setenv("INGEST_ORCHESTRATOR", " Hatchet ")
    monkeypatch.delenv("RESEARCH_ORCHESTRATOR", raising=False)
    assert orchestrator(Tier.INGEST) is Orchestrator.HATCHET
    assert orchestrator(Tier.RESEARCH) is Orchestrator.CLAIM_QUEUE


def test_an_unknown_value_is_refused_not_guessed(monkeypatch):
    monkeypatch.setenv("INGEST_ORCHESTRATOR", "temporal")
    with pytest.raises(ValueError, match="INGEST_ORCHESTRATOR must be one of"):
        orchestrator(Tier.INGEST)


def test_tests_replace_the_client_at_one_place():
    fake = object()
    hatchet_client.reset_for_tests(fake)  # type: ignore[arg-type]
    try:
        assert hatchet_client.client() is fake
    finally:
        hatchet_client.reset_for_tests(None)
