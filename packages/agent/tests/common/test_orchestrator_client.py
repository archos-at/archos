"""The process's Hatchet client: built once, and replaced for tests at one place."""

from __future__ import annotations

from agent.common import orchestrator_client


def test_tests_replace_the_client_at_one_place():
    fake = object()
    orchestrator_client.reset_for_tests(fake)  # type: ignore[arg-type]
    try:
        assert orchestrator_client.client() is fake
    finally:
        orchestrator_client.reset_for_tests(None)
