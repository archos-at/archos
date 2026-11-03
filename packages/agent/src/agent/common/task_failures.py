"""What an orchestrated task tells the orchestrator about its failure: a class and a category, no message.

Hatchet stores what a task raises: ``TaskRunError.from_exception`` keeps
``str(exc)`` and ``traceback.format_exception``, which walks the whole
``__cause__``/``__context__`` chain. An exception's message is free text that
can name a file, a presigned URL or a SQL statement with its parameters, and
the orchestrator's database holds ids and ciphertext only (ADR-0150). So a task
logs the exception in full to our own logs and raises to the engine a
stand-in built here, ``raise … from None``: the original's class name and the
failure category, nothing else.

The category is ``ingest_failures``' vocabulary, which already knows the
timeouts, connection errors and provider 5xx/429 that pass, and names the
provider's in-flight-credit 402 (``credits_in_flight``), which a task waits
out rather than retries at once. This adds what
only a task body meets: the job database going away under it (an operational
error, a dropped connection, a pool timeout), which ``classify`` calls
``transient`` so the engine tries again.

Pure: no I/O and no import of ``hatchet_sdk``; the thin layer that registers a
task turns a :class:`TaskFailure` into the engine's exception
(``hatchet_client.task_error``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from agent.knowledge.ingest_failures import TRANSIENT
from agent.knowledge.ingest_failures import FailureCategory
from agent.knowledge.ingest_failures import classify_failure
from agent.knowledge.ingest_failures import credits_in_flight

#: Database errors, by class name anywhere in the MRO, that say "not now":
#: SQLAlchemy's wrappers, the psycopg/asyncpg/sqlite3 errors under them.
_TRANSIENT_DATABASE: Final = frozenset(
    {
        "OperationalError",
        "InterfaceError",
        "DisconnectionError",
        "ConnectionDoesNotExistError",
        "PostgresConnectionError",
        "CannotConnectNowError",
        "TooManyConnectionsError",
        "SerializationFailure",
        "DeadlockDetected",
    }
)


class TransientTaskError(Exception):
    """A failure that may pass, as the engine receives it: retried under the task's policy."""


@dataclass(frozen=True)
class TaskFailure:
    """A task's failure, reduced to what the orchestrator may store."""

    exc_type: str
    category: FailureCategory
    #: The provider's 402 for credits that requests in flight hold
    #: (``ingest_failures.credits_in_flight``): transient, and cured by waiting.
    credits_in_flight: bool = False

    @property
    def transient(self) -> bool:
        return self.category == TRANSIENT

    @property
    def text(self) -> str:
        """The engine's whole record of it: ``"OperationalError (transient)"``."""
        return f"{self.exc_type} ({self.category})"


def _is_transient_database_error(exc: BaseException) -> bool:
    if getattr(exc, "connection_invalidated", False) is True:
        return True
    return bool({cls.__name__ for cls in type(exc).__mro__} & _TRANSIENT_DATABASE)


def _is_busy_upstream(exc: BaseException) -> bool:
    """An HTTP answer that passes, on an error that carries it as ``status`` (``bff_http.BffRefusedError``)."""
    status = getattr(exc, "status", None)
    return isinstance(status, int) and (status >= 500 or status == 429)


def classify(exc: BaseException) -> TaskFailure:
    """The class and category of ``exc``, and of the cause it wraps when it is a database error's wrapper."""
    cause = exc.__cause__
    if _is_transient_database_error(exc) or _is_busy_upstream(exc):
        return TaskFailure(type(exc).__name__, TRANSIENT)
    if cause is not None and _is_transient_database_error(cause):
        return TaskFailure(type(exc).__name__, TRANSIENT)
    if credits_in_flight(None, exc):
        return TaskFailure(type(exc).__name__, TRANSIENT, credits_in_flight=True)
    return TaskFailure(type(exc).__name__, classify_failure(None, exc).category)
