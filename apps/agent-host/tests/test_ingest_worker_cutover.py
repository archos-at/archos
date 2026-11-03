"""The ingest worker keeps moving the retired claim queue onto Hatchet while API pods still write it (ADR-0150).

The pass itself (hold, claim, hand over, refuse plaintext) is
``packages/agent/tests/knowledge/test_ingest_run_hold.py``'s. Here: that the
worker runs it again and again while the table has jobs, asks only the cheap
check when it has none, and stops asking once it has held none for a while.
"""

from __future__ import annotations

import asyncio

from agent_host.jobs import ingest_worker


def _rows(monkeypatch, *answers: int) -> list[int]:
    """``live_rows`` answers these, then 0; returns the handed-over passes' log."""
    queue = list(answers)
    passes: list[int] = []
    monkeypatch.setattr(ingest_worker.ingest_cutover, "live_rows", lambda: queue.pop(0) if queue else 0)
    monkeypatch.setattr(ingest_worker.ingest_cutover, "redispatch_queued", lambda trigger: passes.append(1) or 1)
    return passes


def test_a_pass_with_no_live_row_asks_only_the_cheap_check(monkeypatch):
    passes = _rows(monkeypatch, 0)

    assert ingest_worker._cut_over() is False
    assert passes == []


def test_a_pass_with_live_rows_hands_over_a_batch(monkeypatch):
    passes = _rows(monkeypatch, 3)

    assert ingest_worker._cut_over() is True
    assert passes == [1]


def test_a_failed_pass_counts_as_one_that_found_jobs(monkeypatch):
    def unreachable():
        raise ConnectionError("database away")

    monkeypatch.setattr(ingest_worker.ingest_cutover, "live_rows", unreachable)

    assert ingest_worker._cut_over() is True


async def test_the_loop_keeps_passing_while_rows_arrive_and_stops_once_quiet(monkeypatch):
    """Rows the old pods wrote after boot are moved on a later pass; quiet passes end the loop."""
    passes = _rows(monkeypatch, 0, 2, 0, 1)

    await asyncio.wait_for(ingest_worker._cutover_loop(asyncio.Event(), every=0.001, quiet_for=0.003), timeout=5)

    # boot (0), a row (2), quiet (0), a row (1), then three quiet passes and the loop ends
    assert passes == [1, 1]


async def test_the_loop_ends_with_the_worker(monkeypatch):
    _rows(monkeypatch, *([1] * 1000))
    stop = asyncio.Event()
    loop = asyncio.create_task(ingest_worker._cutover_loop(stop, every=0.001, quiet_for=1.0))
    await asyncio.sleep(0.02)
    stop.set()

    await asyncio.wait_for(loop, timeout=5)
    assert loop.done()
