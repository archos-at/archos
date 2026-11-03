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


def test_a_rest_call_that_hangs_frees_its_caller_after_the_timeout():
    import threading
    import time

    import pytest

    release = threading.Event()
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        hatchet_client.within_rest_timeout(release.wait, timeout=0.2)
    release.set()
    assert time.monotonic() - started < 2


def test_a_rest_call_in_time_returns_its_result():
    assert hatchet_client.within_rest_timeout(lambda: "cancelled") == "cancelled"
