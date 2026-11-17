from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

from opentelemetry import metrics

logger = logging.getLogger(__name__)

PHASE_HISTOGRAM = "grid.boot.phase_seconds"

_BUCKETS = (0.5, 1, 2, 3, 5, 8, 13, 20, 30, 45, 60, 90, 120)

_histogram = None
_histogram_lock = threading.Lock()


def _phase_histogram():
    global _histogram
    with _histogram_lock:
        if _histogram is None:
            _histogram = metrics.get_meter("agent.boot").create_histogram(
                PHASE_HISTOGRAM,
                unit="s",
                description="Seconds a process spent in one phase of becoming useful.",
                explicit_bucket_boundaries_advisory=_BUCKETS,
            )
        return _histogram


def process_age_seconds(proc: str = "/proc") -> float | None:
    try:
        with open(f"{proc}/uptime", encoding="ascii") as f:
            uptime = float(f.read().split()[0])
        with open(f"{proc}/self/stat", encoding="ascii") as f:
            after_name = f.read().rsplit(")", 1)[1].split()
    except OSError:
        return None
    start_ticks = int(after_name[19])
    return uptime - start_ticks / os.sysconf("SC_CLK_TCK")


_pending: list[tuple[str, str, float]] = []
_pending_lock = threading.Lock()


class BootClock:

    def __init__(self, role: str) -> None:
        self.role = role

    def record(self, phase: str, seconds: float) -> None:
        logger.info("[boot-timing] role=%s phase=%s seconds=%.2f", self.role, phase, seconds)
        with _pending_lock:
            _pending.append((self.role, phase, seconds))

    @contextmanager
    def phase(self, name: str) -> Iterator[None]:
        started = time.monotonic()
        try:
            yield
        finally:
            self.record(name, time.monotonic() - started)

    def ready(self) -> None:
        age = process_age_seconds()
        if age is not None:
            self.record("ready", age)


def flush() -> None:
    global _pending
    with _pending_lock:
        pending, _pending = _pending, []
    histogram = _phase_histogram()
    for role, phase, seconds in pending:
        histogram.record(seconds, {"role": role, "phase": phase})
