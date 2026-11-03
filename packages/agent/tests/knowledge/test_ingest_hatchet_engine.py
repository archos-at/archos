"""The ``ingest-document`` workflow on a real Hatchet engine: the main evidence for the Hatchet layer.

Runs only when ``HATCHET_CLIENT_TOKEN`` and ``HATCHET_CLIENT_HOST_PORT`` name an
engine (CI runs ``hatchet-lite`` as a service container); skipped otherwise.
Each run gets its own namespace, so it shares the engine with nothing.

One worker process (``agent_testing.hatchet_engine_worker``) serves the real
workflow, four slots, with ``INGEST_MAX_PER_ORG=2``; only the ingestor in it is
scripted. The tests trigger runs through ``ingest_hatchet.trigger`` and read the
outcome from the status store the BFF reads, the engine's run status, and the
worker's log of each attempt.

Locally: ``docker run -p 8888:8888 -p 7077:7077 ghcr.io/hatchet-dev/hatchet/hatchet-lite``,
create a token in its UI, then set ``HATCHET_CLIENT_TOKEN``,
``HATCHET_CLIENT_HOST_PORT=localhost:7077`` and ``HATCHET_CLIENT_TLS_STRATEGY=none``.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not (os.environ.get("HATCHET_CLIENT_TOKEN") and os.environ.get("HATCHET_CLIENT_HOST_PORT")),
    reason="needs a Hatchet engine (HATCHET_CLIENT_TOKEN, HATCHET_CLIENT_HOST_PORT)",
)

PER_ORG_CAP = 2
_WAIT_SECONDS = 120


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    """A namespace of our own, a status store both processes share, and the worker serving the workflow."""
    from agent.common import hatchet_client
    from agent.knowledge import ingest_hatchet
    from agent.knowledge import ingest_status_store

    directory = tmp_path_factory.mktemp("hatchet-engine")
    env = {
        **os.environ,
        "HATCHET_CLIENT_NAMESPACE": f"test_{uuid.uuid4().hex[:8]}",
        "SUMMARY_DB": f"sqlite:///{directory}/jobs.db",
        "INGEST_MAX_PER_ORG": str(PER_ORG_CAP),
        "PYTHONPATH": os.pathsep.join(sys.path),
    }
    env.pop("INTERNAL_API_TOKEN", None)  # the settle step sends nothing
    saved = {key: os.environ.get(key) for key in ("HATCHET_CLIENT_NAMESPACE", "SUMMARY_DB", "INGEST_MAX_PER_ORG")}
    os.environ.update({key: env[key] for key in saved})
    hatchet_client.reset_for_tests(None)
    ingest_hatchet._declared = None
    worker = subprocess.Popen(  # noqa: S603 - our own module, with our own interpreter
        [sys.executable, "-m", "agent_testing.hatchet_engine_worker", str(directory)], env=env
    )
    try:
        _wait_for_worker(directory)
        yield directory
    finally:
        worker.terminate()
        worker.wait(timeout=60)
        hatchet_client.reset_for_tests(None)
        ingest_hatchet._declared = None
        ingest_status_store._initialized.discard(env["SUMMARY_DB"])
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _wait_for_worker(directory: Path) -> None:
    """The worker has registered once a warm-up run completes through it.

    A trigger before the worker registered the workflow is refused, so the
    warm-up is retried until the workflow exists.
    """
    deadline = time.monotonic() + _WAIT_SECONDS
    while True:
        try:
            job = _start("ok-warmup", "org-warmup")
            break
        except Exception:  # noqa: BLE001 - not registered yet
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    _until(lambda: _state(job) == "completed", what="the worker to take a first run")


def _start(job_id: str, organization_id: str) -> str:
    from agent_testing import hatchet_engine_worker as scripted

    from agent.knowledge import ingest_hatchet
    from agent.knowledge import ingest_status_store

    job_id = f"{job_id}-{uuid.uuid4().hex[:6]}"
    ingest_status_store.put(scripted.status(job_id, organization_id=organization_id))
    assert ingest_hatchet.trigger(job_id, organization_id, "interactive", scripted.payload(job_id, organization_id))
    return job_id


def _state(job_id: str) -> str | None:
    from agent.knowledge import ingest_status_store

    status = ingest_status_store.get(job_id)
    return status.status.value if status is not None else None


def _run_status(job_id: str) -> str:
    from agent.common import hatchet_client
    from agent.knowledge import ingest_run_hold

    return str(hatchet_client.client().runs.get_status(ingest_run_hold.run_id_of(job_id)).value)


def _until(check, *, what: str, seconds: float = _WAIT_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.5)
    pytest.fail(f"timed out waiting for {what}")


def _events(directory: Path) -> list[tuple[str, str, int, float]]:
    path = directory / "events.log"
    lines = path.read_text().splitlines() if path.exists() else []
    return [(event, job, int(attempt), float(at)) for event, job, attempt, at in (line.split() for line in lines)]


def _attempts(directory: Path, job_id: str) -> int:
    return sum(1 for event, job, _, _ in _events(directory) if event == "start" and job == job_id)


def test_a_document_runs_end_to_end_through_both_steps(engine):
    job = _start("ok", "org-e2e")

    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete")

    assert _state(job) == "completed"
    assert _attempts(engine, job) == 1


def test_a_failure_of_the_moment_is_tried_again_and_completes(engine):
    job = _start("flaky", "org-retry")

    _until(lambda: _state(job) == "completed", what="the second attempt", seconds=_WAIT_SECONDS + 60)

    assert _attempts(engine, job) == 2
    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete")


def test_a_failure_of_the_bytes_is_tried_once_and_fails_the_run(engine):
    job = _start("bytes", "org-bytes")

    _until(lambda: _run_status(job) == "FAILED", what="the run to fail")

    assert _state(job) == "failed"
    time.sleep(10)  # longer than the first backoff: no second attempt comes
    assert _attempts(engine, job) == 1


def test_a_cancelled_job_stops_and_reads_cancelled(engine):
    from agent.knowledge import ingest_hatchet
    from agent.knowledge import ingest_run_hold
    from agent.knowledge import ingest_status_store

    job = _start("slow", "org-cancel")
    _until(lambda: _attempts(engine, job) == 1, what="the run to start")

    ingest_hatchet.cancel_run(ingest_run_hold.run_id_of(job))
    ingest_status_store.settle_cancelled(job)  # what ``ingest_dispatch.cancel`` does after it

    _until(lambda: any(e == "end" and j == job for e, j, _, _ in _events(engine)), what="the run to stop")
    assert _state(job) == "cancelled"
    _until(lambda: _run_status(job) == "CANCELLED", what="the engine to record the cancel")


def test_a_burst_from_one_office_waits_its_turn_and_never_exceeds_its_cap(engine):
    """Office A uploads ten slow files, then office B one: B starts while A's backlog still waits."""
    burst = [_start("slow", "org-a") for _ in range(10)]
    single = _start("slow", "org-b")

    _until(lambda: all(_state(job) == "completed" for job in [*burst, single]), what="every job", seconds=180)

    events = _events(engine)
    starts = {job: at for event, job, _, at in events if event == "start"}
    ends = {job: at for event, job, _, at in events if event == "end"}
    # B did not wait behind A's backlog: it started before the last of A's jobs.
    assert starts[single] < max(starts[job] for job in burst)
    assert starts[single] - min(starts[job] for job in burst) < 2 * 3.0 + 5
    # A never had more than its cap running at once, though the worker had four slots.
    edges = sorted([(starts[job], 1) for job in burst] + [(ends[job], -1) for job in burst])
    running = peak = 0
    for _, step in edges:
        running += step
        peak = max(peak, running)
    assert peak <= PER_ORG_CAP
