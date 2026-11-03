"""The one Hatchet client of this process (ADR-0150).

Background work runs on Hatchet, which replaced our own Postgres claim queues.

Only the thin layer that registers a tier's tasks imports this module. The
pipeline's step functions never import ``hatchet_sdk``: that keeps the
orchestrator replaceable (Temporal is the documented exit).

The connection is the SDK's own configuration, read from its standard
environment variables (``HATCHET_CLIENT_TOKEN``, ``HATCHET_CLIENT_HOST_PORT``,
``HATCHET_CLIENT_TLS_STRATEGY``, ``HATCHET_CLIENT_NAMESPACE``), so nothing here
re-implements it.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from .task_failures import TaskFailure
from .task_failures import TransientTaskError

if TYPE_CHECKING:
    from hatchet_sdk import Hatchet


_lock = threading.Lock()
_client: Hatchet | None = None


def client() -> Hatchet:
    """The process's Hatchet client, built once from the SDK's environment."""
    global _client
    with _lock:
        if _client is None:
            from hatchet_sdk import Hatchet

            _client = Hatchet()
        return _client


def reset_for_tests(fake: Hatchet | None = None) -> None:
    """Replace (or drop) the process's client. Tests fake Hatchet here, at one place."""
    global _client
    with _lock:
        _client = fake


def task_error(failure: TaskFailure, *, retry: bool) -> Exception:
    """What a task raises to the engine for ``failure`` (``raise task_error(...) from None``).

    Its message is ``failure.text`` and nothing else, so the run's record in
    Hatchet names a class and a category, never the original message or its
    chained cause. ``retry`` says whether the task's retry policy applies.
    """
    if retry:
        return TransientTaskError(failure.text)
    from hatchet_sdk import NonRetryableException

    return NonRetryableException(failure.text)
