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


def test_a_rest_call_that_hangs_frees_its_caller_after_the_timeout():
    import threading
    import time

    import pytest

    release = threading.Event()
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        orchestrator_client.within_rest_timeout(release.wait, timeout=0.2)
    release.set()
    assert time.monotonic() - started < 2


def test_a_rest_call_in_time_returns_its_result():
    assert orchestrator_client.within_rest_timeout(lambda: "cancelled") == "cancelled"
