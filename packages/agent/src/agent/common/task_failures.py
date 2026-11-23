from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from agent.knowledge.ingest_failures import TRANSIENT
from agent.knowledge.ingest_failures import FailureCategory
from agent.knowledge.ingest_failures import classify_failure
from agent.knowledge.ingest_failures import credits_in_flight

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


class TransientTaskError(Exception): ...


@dataclass(frozen=True)
class TaskFailure:
    exc_type: str
    category: FailureCategory
    credits_in_flight: bool = False

    @property
    def transient(self) -> bool:
        return self.category == TRANSIENT

    @property
    def text(self) -> str:
        return f"{self.exc_type} ({self.category})"


def _is_transient_database_error(exc: BaseException) -> bool:
    if getattr(exc, "connection_invalidated", False) is True:
        return True
    return bool({cls.__name__ for cls in type(exc).__mro__} & _TRANSIENT_DATABASE)


def _is_busy_upstream(exc: BaseException) -> bool:
    status = getattr(exc, "status", None)
    return isinstance(status, int) and (status >= 500 or status == 429)


def classify(exc: BaseException) -> TaskFailure:
    cause = exc.__cause__
    if _is_transient_database_error(exc) or _is_busy_upstream(exc):
        return TaskFailure(type(exc).__name__, TRANSIENT)
    if cause is not None and _is_transient_database_error(cause):
        return TaskFailure(type(exc).__name__, TRANSIENT)
    if credits_in_flight(None, exc):
        return TaskFailure(type(exc).__name__, TRANSIENT, credits_in_flight=True)
    return TaskFailure(type(exc).__name__, classify_failure(None, exc).category)
