from __future__ import annotations

import contextlib

import grpc
import pytest
from agent_testing import orchestrator_fake

from agent.common import boot_retry
from agent.knowledge import ingest_workflow
from agent.observability import orchestrator_tracing


class _Unavailable(grpc.RpcError):
    def code(self) -> grpc.StatusCode:
        return grpc.StatusCode.UNAVAILABLE


@pytest.fixture
def hatchet(monkeypatch):
    fake = orchestrator_fake.install_for(monkeypatch)
    monkeypatch.setattr(orchestrator_tracing, "instrument", lambda config: None)
    monkeypatch.setattr(boot_retry, "_sleep", lambda seconds: None)
    return fake


def _serve() -> None:
    ingest_workflow.serve(contextlib.nullcontext, lambda stored: stored, slots=1)


def test_a_first_failure_of_the_credit_rate_limit_is_retried(hatchet):
    hatchet.rate_limits.fail_with = [_Unavailable()]

    _serve()

    assert len(hatchet.rate_limits.put_calls) == 2
    assert hatchet.workers[0].started


def test_a_first_failure_of_the_workflow_registration_is_retried(hatchet):
    hatchet.admin.fail_with = [_Unavailable()]

    _serve()

    assert hatchet.admin.put_calls == [ingest_workflow.ingest_workflow().name] * 2
    assert hatchet.workers[0].started


def test_a_refused_registration_stops_the_boot(hatchet):
    hatchet.admin.fail_with = [ValueError("invalid workflow")]

    with pytest.raises(ValueError, match="invalid workflow"):
        _serve()

    assert hatchet.workers == []
