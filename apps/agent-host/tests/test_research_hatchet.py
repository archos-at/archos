"""Research runs on Hatchet (ADR-0150): the code of ours around the engine.

The engine itself is exercised by ``test_research_hatchet_engine.py``, against
a real Hatchet. Here Hatchet is the ``hatchet`` fixture's fake only for the one
wiring test of the submit (what reaches the SDK: ids and ciphertext, never
plaintext) and the cancel's error path; everything else is our own logic: the
refusals before anything is persisted, the task body's failure mapping, the
verdicts, the liveness lifespan and the cutover. The job store is real (SQLite).
"""

from __future__ import annotations

import inspect
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from hatchet_sdk import NonRetryableException
from hatchet_sdk import Priority
from hatchet_sdk.exceptions import TaskRunError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from agent.auth import Principal
from agent.common.task_failures import TransientTaskError
from agent_host.jobs import access as job_access
from agent_host.jobs import orchestrator_runs
from agent_host.jobs import payload_crypto
from agent_host.jobs import requeue_legacy
from agent_host.jobs import research_hatchet
from agent_host.jobs import submit
from agent_host.jobs import worker as worker_mod
from agent_host.jobs.agent_job import run_agent_job
from agent_host.jobs.event_store import EventStore
from agent_host.routes import job_kill

SECRET_QUESTION = "Wie hoch darf das Atrium im Bestand werden?"
OWNER = Principal(type="jwt", sub="user-1", email="user@example.com")


@pytest.fixture
def db_url(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", url)
    EventStore._tables_initialized.clear()
    job_access._job_access_schema_initialized.clear()
    orchestrator_runs._ensured.clear()
    yield url
    orchestrator_runs._ensured.clear()


def _job_store() -> MagicMock:
    store = MagicMock()
    store.ensure_job_id.side_effect = lambda job_id: job_id or "generated-job-id"
    store._create_job = AsyncMock(return_value=None)
    return store


async def _submit(job_id: str = "job-1", *, priority: str | None = None, organization_id: str = "org-a") -> str:
    with patch("nat.front_ends.fastapi.async_jobs.job_store.JobStore", return_value=_job_store()):
        return await submit.submit_agent_job(
            agent_type="deep_researcher",
            input_text=SECRET_QUESTION,
            owner="user@example.com",
            principal=OWNER,
            job_id=job_id,
            usage_context={"identity": {"organization_id": organization_id, "user_id": "user-1"}},
            priority=priority,
        )


# ---------------------------------------------------------------- submit


async def test_a_submit_starts_research_run_with_ids_and_ciphertext_only(db_url, hatchet):
    await _submit()

    [started] = hatchet.started
    run = started["input"]
    assert isinstance(run, research_hatchet.ResearchRunInput)
    assert (run.job_id, run.organization_id, run.priority) == ("job-1", "org-a", "interactive")
    assert run.payload.startswith("enc:")
    assert SECRET_QUESTION not in run.model_dump_json()
    assert payload_crypto.deserialize(run.payload)["input_text"] == SECRET_QUESTION
    assert started["priority"] is Priority.HIGH
    assert started["additional_metadata"] == {"job_id": "job-1", "organization_id": "org-a"}
    assert hatchet.workflows[0].declared["name"] == "research-run"
    assert orchestrator_runs.run_id_for(db_url, "job-1") == "run-1"


async def test_an_unknown_priority_is_refused_before_anything_is_persisted(db_url, hatchet):
    with pytest.raises(ValueError, match="unknown research job priority"):
        await _submit(priority="urgent")

    assert hatchet.started == []
    assert job_access.get_job_access("job-1", db_url) is None


async def test_without_a_key_nothing_reaches_hatchet_and_the_job_is_rolled_back(db_url, hatchet, monkeypatch):
    monkeypatch.delenv("JOB_PAYLOAD_KEK")

    with pytest.raises(payload_crypto.PayloadKeyError):
        await _submit()

    assert hatchet.started == []
    assert job_access.get_job_access("job-1", db_url) is None


# ---------------------------------------------------------------- cancel


async def test_a_failed_hatchet_cancel_leaves_the_status_flip_to_stop_the_run(db_url, hatchet, monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(job_kill, "notify_job_outcome_from_access", notify)
    hatchet.runs.aio_cancel.side_effect = ConnectionError("engine unreachable")
    await _submit()

    await job_kill.stop_interrupted_job(db_url, "job-1", reason="cancelled by user")

    hatchet.runs.aio_cancel.assert_awaited_once_with("run-1")
    notify.assert_awaited_once()  # the verdict is reported all the same


async def test_a_job_with_no_recorded_run_cancels_nothing(db_url, hatchet):
    assert await research_hatchet.cancel(db_url, "job-unknown") is False
    hatchet.runs.aio_cancel.assert_not_awaited()


# ---------------------------------------------------------------- the task


def _stored(**overrides: Any) -> str:
    payload = {
        "configure_logging": False,
        "log_level": 20,
        "db_url": "sqlite:///unused.db",
        "config_file_path": "configs/config.yml",
        "job_id": "job-1",
        "input_text": SECRET_QUESTION,
        "agent_class_path": "agent.agents.deep_researcher.agent.DeepResearcherAgent",
        "agent_config_name": "deep_research_agent",
        **overrides,
    }
    return payload_crypto.serialize_encrypted(payload)


def _input(stored: str) -> research_hatchet.ResearchRunInput:
    return research_hatchet.ResearchRunInput(
        job_id="job-1", organization_id="org-a", priority="interactive", payload=stored
    )


@pytest.fixture
def replayed(monkeypatch) -> list:
    """``run_agent_job`` bound against its real signature, as in ``test_retired_payload_keys``."""
    calls: list = []
    signature = inspect.signature(run_agent_job)

    async def _bind_like_the_real_one(**kwargs):
        signature.bind(**kwargs)
        calls.append(kwargs)

    monkeypatch.setattr(worker_mod, "run_agent_job", _bind_like_the_real_one)
    monkeypatch.setattr(worker_mod.run_ownership, "take_ownership", _owns)  # ownership: test_run_ownership.py
    return calls


async def test_the_task_runs_the_payload_and_forgets_its_run_id(db_url, replayed):
    orchestrator_runs.record(db_url, "job-1", "run-1")

    result = await research_hatchet.run_task(_input(_stored()))

    assert result == {"job_id": "job-1", "ran": "yes"}
    assert [kwargs["input_text"] for kwargs in replayed] == [SECRET_QUESTION]
    assert orchestrator_runs.run_id_for(db_url, "job-1") is None


async def test_an_unreadable_payload_records_its_verdict_and_is_not_retried(db_url, replayed, monkeypatch):
    verdicts = AsyncMock()
    monkeypatch.setattr(worker_mod, "record_poison_verdict", verdicts)

    with pytest.raises(NonRetryableException):
        await research_hatchet.run_task(_input("enc:not-a-ciphertext"))

    assert replayed == []
    verdicts.assert_awaited_once()
    assert verdicts.await_args.args[:2] == (db_url, "job-1")


async def test_a_deterministic_run_failure_is_not_retried(db_url, replayed):
    with pytest.raises(NonRetryableException, match="TypeError"):
        await research_hatchet.run_task(_input(_stored(not_a_parameter=1)))


def _what_hatchet_stores(raised: BaseException) -> str:
    """The failure as the SDK serialises it into the engine: message and the whole traceback chain."""
    return TaskRunError.from_exception(raised, "step-run-1").serialize(include_metadata=True)


async def test_a_transient_database_error_before_the_run_is_retried_and_keeps_the_run_id(db_url, monkeypatch):
    """A database that is away at ``try_take`` is the moment, not the job: Hatchet tries again."""
    orchestrator_runs.record(db_url, "job-1", "run-1")

    async def _database_away(*_args):
        raise OperationalError("UPDATE job_info SET ... /srv/uploads/Bauantrag.pdf", {}, ConnectionError("gone"))

    monkeypatch.setattr(worker_mod.run_ownership, "take_ownership", _database_away)

    with pytest.raises(TransientTaskError) as raised:
        await research_hatchet.run_task(_input(_stored()))

    assert not isinstance(raised.value, NonRetryableException)
    assert str(raised.value) == "OperationalError (transient)"
    assert orchestrator_runs.run_id_for(db_url, "job-1") == "run-1"  # the retry's cancel still finds it


@pytest.mark.parametrize(
    "failure",
    [
        ValueError(f"https://s3.example/bucket/Bauantrag.pdf?X-Amz-Signature=abc {SECRET_QUESTION}"),
        TimeoutError(f"reading https://s3.example/bucket/Bauantrag.pdf {SECRET_QUESTION}"),
    ],
    ids=["deterministic", "transient"],
)
async def test_what_hatchet_receives_names_a_class_and_a_category_never_the_message(
    db_url, replayed, monkeypatch, failure
):
    async def _fails(**_kwargs):
        try:
            raise KeyError(SECRET_QUESTION)
        except KeyError as inner:
            raise failure from inner

    monkeypatch.setattr(worker_mod, "run_agent_job", _fails)

    with pytest.raises(Exception) as raised:
        await research_hatchet.run_task(_input(_stored()))

    stored = _what_hatchet_stores(raised.value)
    assert type(failure).__name__ in stored
    for secret in ("Bauantrag", "s3.example", SECRET_QUESTION, "KeyError"):
        assert secret not in stored
    assert raised.value.__cause__ is None and raised.value.__suppress_context__ is True


async def test_an_unreadable_payload_reaches_hatchet_without_its_detail(db_url, replayed, monkeypatch):
    monkeypatch.setattr(worker_mod, "record_poison_verdict", AsyncMock())

    with pytest.raises(NonRetryableException) as raised:
        await research_hatchet.run_task(_input("enc:not-a-ciphertext"))

    assert str(raised.value) == "PoisonPayloadError (deterministic)"
    assert "undecryptable" not in _what_hatchet_stores(raised.value)


async def test_spent_attempts_fail_the_job_unless_a_verdict_stands(db_url, monkeypatch):
    verdict = AsyncMock()
    monkeypatch.setattr(worker_mod, "record_exhausted_verdict", verdict)

    await research_hatchet.record_failure(_input("enc:x"))

    verdict.assert_awaited_once_with(db_url, "job-1")


class TestVerdicts:
    """The two verdicts a run that never reached ``run_agent_job`` needs written for it."""

    @pytest.fixture
    def written(self, monkeypatch) -> list:
        calls: list = []

        async def conditional(_store, job_id, status, **kwargs):
            calls.append((job_id, status.value, kwargs.get("error")))
            return True

        monkeypatch.setattr(worker_mod, "_update_status_if_not_terminal", conditional)
        monkeypatch.setattr(worker_mod, "_job_store", lambda db_url: object())
        return calls

    async def test_exhausted_attempts_write_failure_and_report_it(self, written, monkeypatch):
        notify = AsyncMock()
        monkeypatch.setattr(worker_mod, "notify_job_outcome_from_access", notify)

        await worker_mod.record_exhausted_verdict("sqlite://", "job-1")

        assert written == [("job-1", "failure", worker_mod.RETRIES_EXHAUSTED_ERROR)]
        notify.assert_awaited_once_with(
            job_id="job-1", db_url="sqlite://", status="failure", error=worker_mod.RETRIES_EXHAUSTED_ERROR
        )

    async def test_a_poison_payload_writes_failure_and_its_error_event(self, written, monkeypatch, tmp_path):
        notify = AsyncMock()
        monkeypatch.setattr(worker_mod, "notify_job_outcome_from_access", notify)
        db_url = f"sqlite:///{tmp_path / 'events.db'}"

        await worker_mod.record_poison_verdict(db_url, "job-1", "ValueError: unreadable")

        assert written == [("job-1", "failure", worker_mod.POISON_PAYLOAD_ERROR)]
        notify.assert_awaited_once()
        events = EventStore.get_events(db_url, "job-1")
        assert [event["type"] for event in events] == ["job.error"]


async def test_the_envelope_is_renewed_at_task_start_by_the_run_path():
    """ADR-0108: the renewal is inside ``run_agent_job``'s setup, which the task calls unchanged."""
    import agent_host.jobs.agent_job_setup as setup

    assert "envelope_headers_for_run(" in inspect.getsource(setup)
    assert "run_agent_job(" in inspect.getsource(worker_mod.run_stored_job)


# ---------------------------------------------------------------- the worker


async def test_the_worker_lifespan_keeps_the_liveness_file_fresh(tmp_path, monkeypatch):
    marker = tmp_path / "alive"
    monkeypatch.setenv("WORKER_LIVENESS_FILE", str(marker))

    lifespan = research_hatchet._liveness()
    await lifespan.__anext__()
    import asyncio

    await asyncio.sleep(0)
    assert marker.read_text() == "ok"
    await lifespan.aclose()


# ---------------------------------------------------------------- the cutover


_OLD_COLUMNS = "(job_id, lane, payload, status, priority)"


def _old_queue(db_url: str, rows: list[tuple[str, str, str, int, str]]) -> None:
    with EventStore._get_or_create_sync_engine(db_url).begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE research_job_queue (job_id VARCHAR PRIMARY KEY, lane VARCHAR, payload TEXT,"
                " status VARCHAR, priority INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(text("CREATE TABLE IF NOT EXISTS job_info (job_id TEXT PRIMARY KEY, status TEXT)"))
        for job_id, lane, payload, priority, status in rows:
            conn.execute(
                text(f"INSERT INTO research_job_queue {_OLD_COLUMNS} VALUES (:j, :l, :p, :s, :r)"),
                {"j": job_id, "l": lane, "p": payload, "s": status, "r": priority},
            )
            conn.execute(text("INSERT INTO job_info VALUES (:j, 'submitted')"), {"j": job_id})


async def test_the_cutover_starts_every_live_row_once_and_empties_the_old_queue(db_url, monkeypatch):
    started: dict[str, tuple[str | None, str | None]] = {}

    async def start(db_url, job_id, payload, organization_id, priority):
        assert "claim_owner" in payload  # replayed as stored; the worker drops it
        started[job_id] = (organization_id, priority)
        orchestrator_runs.record(db_url, job_id, f"run-{job_id}")
        return f"run-{job_id}"

    monkeypatch.setattr(research_hatchet, "start", start)
    old = _stored(claim_owner="host:1")
    _old_queue(
        db_url,
        [
            ("job-a", "org-a", old, 1, "queued"),
            ("job-b", "__platform__", old, 0, "claimed"),
            ("job-c", "org-a", "enc:garbage", 0, "queued"),
            ("job-d", "org-a", old, 0, "dead"),
        ],
    )

    result = await requeue_legacy.requeue(db_url)

    assert result.started == ["job-a", "job-b"]
    assert result.unreadable == ["job-c"]
    assert started == {"job-a": ("org-a", "bulk"), "job-b": (None, "interactive")}
    assert (await requeue_legacy.requeue(db_url)).started == []  # a second run starts nothing
    with EventStore._get_or_create_sync_engine(db_url).connect() as conn:
        left = [row[0] for row in conn.execute(text("SELECT job_id FROM research_job_queue ORDER BY job_id"))]
    assert left == ["job-c", "job-d"]


async def _owns(*_args) -> bool:
    return True
