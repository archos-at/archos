from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Iterator
from typing import Any

from agent.observability.retrieval_trace import emit_step_span


def now() -> float:
    try:
        from nat.utils.providers import current_time

        return current_time()
    except Exception:  # noqa: BLE001 - telemetry must never take a turn down
        import time

        return time.time()


@contextlib.contextmanager
def observed_phase(name: str, **facts: Any) -> Iterator[dict[str, Any]]:
    started = now()
    outcome: dict[str, Any] = {}
    status = "ok"
    try:
        yield outcome
    except asyncio.CancelledError, GeneratorExit:
        status = "cancelled"
        raise
    except BaseException as exc:
        status = "error"
        outcome["error"] = type(exc).__name__
        raise
    finally:
        ended = now()
        outcome = {"outcome": status, **outcome, "ms": round(1000 * (ended - started), 1)}
        emit_step_span(name, dict(facts), outcome, started_at=started, ended_at=ended)
