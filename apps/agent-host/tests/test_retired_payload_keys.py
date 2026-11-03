"""A payload written by an earlier release still runs after the upgrade.

Root cause: a research job's payload is the kwargs the worker replays with
``run_agent_job(**payload)``. The release before #887 wrote ``scheduler_address``
(its Dask scheduler) into every payload, and #887 removed that parameter; the
release before ADR-0150 wrote ``claim_owner`` (the claim queue's worker id), and
the move to Hatchet removed that one. A stored payload replayed after such an
upgrade (a Hatchet retry, or the cutover's re-dispatch of the old queue's rows)
died with a TypeError.

Why missed: the worker tests stub ``run_agent_job`` with ``**kwargs``, which
accepts anything, and no test replayed a payload written by an earlier release.

The fix: ``worker.RETIRED_PAYLOAD_KEYS`` names the keys old releases wrote, and
the worker drops exactly those after decryption. Anything else unknown still
fails loudly.

Ratchet: the stub below binds against the REAL ``run_agent_job`` signature, so a
stale or misspelled key fails here as it would in production. The payloads go
through the real payload encryption and the real ``research-run`` task body.
"""

from __future__ import annotations

import inspect

import pytest

from agent_host.jobs import payload_crypto
from agent_host.jobs import research_hatchet
from agent_host.jobs import worker as worker_mod
from agent_host.jobs.agent_job import run_agent_job

#: What the claim-queue releases stored, with both keys they carried.
OLD_PAYLOAD = {
    "configure_logging": False,
    "log_level": 20,
    "scheduler_address": "tcp://127.0.0.1:8786",
    "db_url": "sqlite:///unused.db",
    "config_file_path": "configs/config.yml",
    "job_id": "job-old",
    "input_text": "pre-upgrade question",
    "agent_class_path": "agent.agents.deep_researcher.agent.DeepResearcherAgent",
    "agent_config_name": "deep_research_agent",
    "claim_owner": "host:123",
}


@pytest.fixture
def db_url(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/jobs.db"
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", url)
    monkeypatch.delenv("DEEP_CHECKPOINT_DB", raising=False)
    return url


@pytest.fixture
def replayed(monkeypatch) -> list:
    """Stand in for ``run_agent_job`` with its real signature: a bad key raises as it would in production."""
    calls: list = []
    signature = inspect.signature(run_agent_job)

    async def _bind_like_the_real_one(**kwargs):
        signature.bind(**kwargs)
        calls.append(kwargs)

    monkeypatch.setattr(worker_mod, "run_agent_job", _bind_like_the_real_one)
    monkeypatch.setattr(worker_mod.run_ownership, "take_ownership", _owns)  # ownership: test_run_ownership.py
    return calls


def _run(payload: dict) -> research_hatchet.ResearchRunInput:
    return research_hatchet.ResearchRunInput(
        job_id=payload["job_id"],
        organization_id="org-a",
        priority="interactive",
        payload=payload_crypto.serialize_encrypted(payload),
    )


async def test_an_old_payload_replays_without_its_retired_keys(db_url, replayed):
    await research_hatchet.run_task(_run(dict(OLD_PAYLOAD)))

    assert len(replayed) == 1
    assert "scheduler_address" not in replayed[0]
    assert "claim_owner" not in replayed[0]
    assert replayed[0]["input_text"] == "pre-upgrade question"


async def _run_and_collect_failure(payload: dict) -> BaseException:
    with pytest.raises(Exception) as raised:
        await worker_mod.run_stored_job("sqlite:///unused.db", payload["job_id"], _run(payload).payload)
    return raised.value


async def test_unknown_key_in_a_new_payload_still_fails(db_url, replayed):
    """No general ignore-unknown filter: a typo or a stale key in a NEW payload must stay loud."""
    new_payload = {k: v for k, v in OLD_PAYLOAD.items() if k not in worker_mod.RETIRED_PAYLOAD_KEYS}
    new_payload.update(job_id="job-new", not_a_parameter=1)

    error = await _run_and_collect_failure(new_payload)

    assert replayed == []
    assert isinstance(error, TypeError)
    assert "not_a_parameter" in str(error)


async def test_a_retired_key_does_not_hide_an_unknown_one(db_url, replayed):
    payload = {**OLD_PAYLOAD, "job_id": "job-mixed", "not_a_parameter": 1}

    error = await _run_and_collect_failure(payload)

    assert replayed == []
    assert isinstance(error, TypeError)
    assert "not_a_parameter" in str(error)
    assert "scheduler_address" not in str(error)


def test_only_the_named_retired_keys_are_dropped():
    kwargs = worker_mod._replay_kwargs({"job_id": "j", "scheduler_address": "x", "claim_owner": "w", "other": 1})

    assert kwargs == {"job_id": "j", "other": 1}
    assert worker_mod.RETIRED_PAYLOAD_KEYS == {"scheduler_address", "claim_owner"}


def test_no_retired_key_is_a_parameter_again():
    """A retired name that comes back as a parameter would be silently dropped from every payload."""
    assert not worker_mod.RETIRED_PAYLOAD_KEYS & set(inspect.signature(run_agent_job).parameters)


async def _owns(*_args) -> bool:
    return True
