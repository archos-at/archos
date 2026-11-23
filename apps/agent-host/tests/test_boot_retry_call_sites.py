from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import grpc
import psycopg
import pytest
from agent_testing import orchestrator_fake
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from agent.common import boot_retry
from agent.observability import orchestrator_tracing
from agent.observability import otlp_metrics
from agent_host.jobs import access as job_access
from agent_host.jobs import orchestrator_runs
from agent_host.jobs import research_workflow
from agent_host.jobs.event_store import EventStore
from agent_host.routes import jobs as jobs_routes


class _Unavailable(grpc.RpcError):
    def code(self) -> grpc.StatusCode:
        return grpc.StatusCode.UNAVAILABLE


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    monkeypatch.setattr(boot_retry, "_sleep", lambda seconds: None)


def test_the_research_worker_retries_a_first_failed_registration(monkeypatch):
    hatchet = orchestrator_fake.install_for(monkeypatch)
    monkeypatch.setattr(orchestrator_tracing, "instrument", lambda config: None)
    monkeypatch.setattr(otlp_metrics, "install_from_env", lambda: None)
    hatchet.admin.fail_with = [_Unavailable()]

    research_workflow.run_worker()

    assert hatchet.admin.put_calls == [research_workflow.TASK_NAME] * 2
    assert hatchet.workers[0].started


@pytest.fixture
def db_url(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", url)
    EventStore._tables_initialized.clear()
    job_access._job_access_schema_initialized.clear()
    orchestrator_runs._ensured.clear()
    yield url
    EventStore._tables_initialized.clear()
    job_access._job_access_schema_initialized.clear()
    orchestrator_runs._ensured.clear()


def test_the_api_retries_its_job_tables_while_postgres_restarts(db_url, monkeypatch):
    real = job_access.ensure_job_access_table
    calls: list[str] = []

    def ensure_once_refused(url: str) -> None:
        calls.append(url)
        if len(calls) == 1:
            raise OperationalError(
                "SELECT 1", {}, psycopg.OperationalError("FATAL:  the database system is starting up")
            )
        real(url)

    monkeypatch.setattr(job_access, "ensure_job_access_table", ensure_once_refused)
    worker = SimpleNamespace(
        _db_url=db_url, _config_file_path="config.yml", _front_end_config=SimpleNamespace(expiry_seconds=86400)
    )

    asyncio.run(jobs_routes.register_job_routes(FastAPI(), MagicMock(), worker))

    assert calls == [db_url, db_url]
    assert db_url in EventStore._tables_initialized
