"""Admission waits instead of refusing (ADR-0079, ADR-0150, ``jobs/submit.py``).

Capacity makes a research job WAIT on Hatchet; the only 429 left is an
organization's own waiting jobs past their bound. A waiting job is ``submitted``
in ``job_info``, its organization on its ``job_access`` row; both are real here (SQLite).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from agent.common.job_admission import JobAdmissionError
from agent_host.jobs import orchestrator_runs
from agent_host.jobs import submit
from agent_host.jobs.event_store import EventStore


@pytest.fixture
def db_url(tmp_path):
    url = f"sqlite:///{tmp_path}/jobs.db"
    with EventStore._get_or_create_sync_engine(url).begin() as conn:
        conn.execute(text("CREATE TABLE job_info (job_id TEXT PRIMARY KEY, status TEXT)"))
        conn.execute(text("CREATE TABLE job_access (job_id TEXT PRIMARY KEY, organization_id TEXT)"))
    return url


def _fill(db_url: str, organization_id: str | None, jobs: int, status: str = "submitted") -> None:
    with EventStore._get_or_create_sync_engine(db_url).begin() as conn:
        for n in range(jobs):
            job_id = f"{organization_id}-{status}-{n}"
            conn.execute(text("INSERT INTO job_info VALUES (:j, :s)"), {"j": job_id, "s": status})
            conn.execute(text("INSERT INTO job_access VALUES (:j, :o)"), {"j": job_id, "o": organization_id})


async def test_scheduled_work_piling_up_in_one_organization_is_still_admitted_below_the_bound(db_url, monkeypatch):
    monkeypatch.setenv("MAX_QUEUED_JOBS_PER_ORG", "5")
    _fill(db_url, "org-a", 4)

    await submit._enforce_job_admission(db_url, "org-a")


async def test_an_organization_past_its_waiting_bound_is_refused_and_nobody_else_is(db_url, monkeypatch):
    monkeypatch.setenv("MAX_QUEUED_JOBS_PER_ORG", "3")
    _fill(db_url, "org-a", 3)

    with pytest.raises(JobAdmissionError, match="3 research jobs waiting"):
        await submit._enforce_job_admission(db_url, "org-a")
    await submit._enforce_job_admission(db_url, "org-b")  # another office's queue is its own


async def test_running_and_finished_jobs_do_not_count_against_the_waiting_bound(db_url, monkeypatch):
    monkeypatch.setenv("MAX_QUEUED_JOBS_PER_ORG", "2")
    _fill(db_url, "org-a", 1)
    _fill(db_url, "org-a", 5, status="running")
    _fill(db_url, "org-a", 5, status="success")

    await submit._enforce_job_admission(db_url, "org-a")


async def test_jobs_of_no_organization_wait_in_their_own_lane(db_url):
    _fill(db_url, None, 2)
    _fill(db_url, "org-a", 1)

    assert orchestrator_runs.waiting_for_org(db_url, None) == 2
    assert orchestrator_runs.waiting_for_org(db_url, "org-a") == 1


async def test_the_waiting_bound_can_be_switched_off(db_url, monkeypatch):
    monkeypatch.setenv("MAX_QUEUED_JOBS_PER_ORG", "0")
    _fill(db_url, "org-a", 60)

    await submit._enforce_job_admission(db_url, "org-a")


async def test_a_store_that_cannot_be_read_admits_the_job(monkeypatch):
    def broken(*_args):
        raise ConnectionError("database restarting")

    monkeypatch.setattr(orchestrator_runs, "waiting_for_org", broken)

    await submit._enforce_job_admission("sqlite://", "org-a")
