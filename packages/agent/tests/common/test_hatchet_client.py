"""The process's Hatchet client: built once, and replaced for tests at one place."""

from __future__ import annotations

from agent.common import hatchet_client


def test_tests_replace_the_client_at_one_place():
    fake = object()
    hatchet_client.reset_for_tests(fake)  # type: ignore[arg-type]
    try:
        assert hatchet_client.client() is fake
    finally:
        hatchet_client.reset_for_tests(None)
