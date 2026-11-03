"""What a task tells the orchestrator about a failure: a class and a category, and which of them pass."""

from __future__ import annotations

import sqlite3

import pytest
from hatchet_sdk import NonRetryableException
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import OperationalError

from agent.common import orchestrator_client
from agent.common import task_failures
from agent.common.bff_http import BffRefusedError
from agent.common.task_failures import TransientTaskError


class _ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"provider answered {status_code}")
        self.status_code = status_code


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (OperationalError("SELECT 1", {}, sqlite3.OperationalError("database is locked")), "transient"),
        (DBAPIError("SELECT 1", {}, Exception("x"), connection_invalidated=True), "transient"),
        (sqlite3.OperationalError("database is locked"), "transient"),
        (RuntimeError("wrapped"), "unknown"),
        (TimeoutError("read timed out"), "transient"),
        (_ProviderError(503), "transient"),
        (_ProviderError(429), "transient"),
        (_ProviderError(400), "deterministic"),
        (BffRefusedError("refused", status=502, body={}), "transient"),
        (TypeError("unexpected keyword argument"), "unknown"),
    ],
    ids=["sqlalchemy", "invalidated", "sqlite3", "plain", "timeout", "5xx", "429", "400", "bff-5xx", "typeerror"],
)
def test_a_failure_is_classified_by_its_class_and_never_carries_its_message(error, category):
    failure = task_failures.classify(error)

    assert failure.category == category
    assert failure.text == f"{type(error).__name__} ({category})"


def test_no_allowed_eu_endpoint_is_retried_by_the_engine():
    error = _ProviderError(404)
    error.args = ("Error code: 404 - No allowed providers are available for the selected model.",)
    assert task_failures.classify(error).transient


def test_a_wrapper_of_a_database_error_is_transient():
    try:
        try:
            raise sqlite3.OperationalError("database is locked")
        except sqlite3.OperationalError as inner:
            raise RuntimeError("could not take the job") from inner
    except RuntimeError as outer:
        assert task_failures.classify(outer).transient is True


def test_the_engine_exception_retries_only_when_asked():
    failure = task_failures.TaskFailure("OperationalError", "transient")

    assert type(orchestrator_client.task_error(failure, retry=True)) is TransientTaskError
    refused = orchestrator_client.task_error(failure, retry=False)
    assert isinstance(refused, NonRetryableException)
    assert str(refused) == "OperationalError (transient)"
