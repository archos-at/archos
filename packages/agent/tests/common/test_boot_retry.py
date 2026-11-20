import errno
import logging
import socket

import grpc
import psycopg
import pytest
from sqlalchemy.exc import OperationalError as SAOperationalError

from agent.common import boot_retry


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds

    async def async_sleep(self, seconds: float) -> None:
        self.sleep(seconds)


@pytest.fixture
def clock(monkeypatch) -> _Clock:
    fake = _Clock()
    monkeypatch.setattr(boot_retry, "_monotonic", fake.monotonic)
    monkeypatch.setattr(boot_retry, "_sleep", fake.sleep)
    monkeypatch.setattr(boot_retry, "_async_sleep", fake.async_sleep)
    return fake


def _failing(errors: list[Exception], result: str = "ok"):
    calls = {"n": 0}

    def call() -> str:
        calls["n"] += 1
        if errors:
            raise errors.pop(0)
        return result

    return call, calls


class _RpcError(grpc.RpcError):
    def __init__(self, status: grpc.StatusCode) -> None:
        self._status = status

    def code(self) -> grpc.StatusCode:
        return self._status


def _sqlalchemy_wrapped(message: str) -> SAOperationalError:
    return SAOperationalError("SELECT 1", {}, psycopg.OperationalError(message))


@pytest.mark.parametrize(
    "error",
    [
        ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused"),
        OSError(errno.EHOSTUNREACH, "No route to host"),
        socket.gaierror(socket.EAI_NONAME, "Name or service not known"),
        TimeoutError("timed out"),
        psycopg.OperationalError("connection failed: FATAL:  the database system is starting up"),
        psycopg.OperationalError("connection failed: FATAL:  the database system is shutting down"),
        _sqlalchemy_wrapped('connection to server at "10.0.0.5", port 5432 failed: Connection refused'),
        _RpcError(grpc.StatusCode.UNAVAILABLE),
        _RpcError(grpc.StatusCode.DEADLINE_EXCEEDED),
    ],
)
def test_connection_class_errors_are_retryable(error):
    assert boot_retry.is_connection_error(error)


@pytest.mark.parametrize(
    "error",
    [
        ValueError("bad config"),
        psycopg.OperationalError('connection to server at "db" failed: FATAL:  password authentication failed'),
        _sqlalchemy_wrapped('relation "x" does not exist'),
        _RpcError(grpc.StatusCode.UNAUTHENTICATED),
        _RpcError(grpc.StatusCode.INVALID_ARGUMENT),
    ],
)
def test_other_errors_are_not_retryable(error):
    assert not boot_retry.is_connection_error(error)


def test_retries_a_connection_error_then_succeeds(clock, caplog):
    call, calls = _failing([ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")] * 2)

    with caplog.at_level(logging.WARNING, logger=boot_retry.__name__):
        assert boot_retry.retry_connection(call, what="probe", budget=60) == "ok"

    assert calls["n"] == 3
    assert len(clock.slept) == 2
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert [r.args[1] for r in warnings] == [1, 2]
    assert all("Connection refused" in r.getMessage() for r in warnings)


def test_backoff_doubles_with_jitter_and_caps(clock):
    call, _ = _failing([TimeoutError("timed out")] * 8)

    boot_retry.retry_connection(call, what="probe", budget=1000)

    ceilings = [1, 2, 4, 8, 15, 15, 15, 15]
    assert all(ceiling / 2 <= slept <= ceiling for slept, ceiling in zip(clock.slept, ceilings, strict=True))


def test_gives_up_after_the_budget(clock):
    error = ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")
    call, calls = _failing([error] * 1000)

    with pytest.raises(ConnectionRefusedError):
        boot_retry.retry_connection(call, what="probe", budget=30)

    assert clock.now <= 30
    assert 3 <= calls["n"] < 20


def test_budget_comes_from_the_environment(clock, monkeypatch):
    monkeypatch.setenv(boot_retry.BUDGET_ENV, "0")
    call, calls = _failing([TimeoutError("timed out")])

    with pytest.raises(TimeoutError):
        boot_retry.retry_connection(call, what="probe")

    assert calls["n"] == 1


def test_does_not_retry_a_non_connection_error(clock):
    call, calls = _failing([ValueError("bad config")])

    with pytest.raises(ValueError, match="bad config"):
        boot_retry.retry_connection(call, what="probe", budget=60)

    assert calls["n"] == 1
    assert clock.slept == []


@pytest.mark.asyncio
async def test_async_retries_a_connection_error_then_succeeds(clock):
    errors = [psycopg.OperationalError("FATAL:  the database system is starting up")]

    async def call() -> str:
        if errors:
            raise errors.pop(0)
        return "ok"

    assert await boot_retry.retry_connection_async(call, what="probe", budget=60) == "ok"
    assert len(clock.slept) == 1


@pytest.mark.asyncio
async def test_async_does_not_retry_a_non_connection_error(clock):
    async def call() -> str:
        raise ValueError("bad config")

    with pytest.raises(ValueError, match="bad config"):
        await boot_retry.retry_connection_async(call, what="probe", budget=60)
    assert clock.slept == []
