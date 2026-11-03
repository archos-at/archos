"""``ingest-document`` in steps on a real Hatchet engine: the evidence for the page fan-out's layer (ADR-0151).

Runs only when ``HATCHET_CLIENT_TOKEN`` and ``HATCHET_CLIENT_HOST_PORT`` name an
engine (CI's ``Hatchet engine tests`` job runs ``hatchet-lite``); skipped otherwise.
One worker process (``agent_testing.hatchet_page_fan_out_worker``) serves the real
declaration with ``INGEST_PAGE_FAN_OUT=on``, eight slots and a fleet cap of two
page tasks (``VLM_FLEET_CONCURRENCY=2``); only the step functions are scripted.

What only an engine can show, and these hold:

* the engine accepts the declaration: tenant-scoped named limits on two tasks of a
  workflow of several (it refuses them at the workflow's level), a durable step
  that starts child runs, ``skip_if`` on a parent's output;
* the durable ``read-pages`` waits for its pages without holding the slots they need;
* a page that fails is tried again alone;
* ``read-page`` never runs more than the fleet cap at once, though the worker has
  slots for more.
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

FLEET_CAP = 2
_WAIT_SECONDS = 180


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    from agent.common import hatchet_client
    from agent.knowledge import ingest_hatchet
    from agent.knowledge import ingest_status_store

    directory = tmp_path_factory.mktemp("hatchet-page-fan-out")
    env = {
        **os.environ,
        "HATCHET_CLIENT_NAMESPACE": f"test_{uuid.uuid4().hex[:8]}",
        "SUMMARY_DB": f"sqlite:///{directory}/jobs.db",
        "INGEST_PAGE_FAN_OUT": "on",
        "VLM_FLEET_CONCURRENCY": str(FLEET_CAP),
        "PYTHONPATH": os.pathsep.join(sys.path),
    }
    env.pop("INTERNAL_API_TOKEN", None)  # the settle step sends nothing
    keys = ("HATCHET_CLIENT_NAMESPACE", "SUMMARY_DB", "INGEST_PAGE_FAN_OUT")
    saved = {key: os.environ.get(key) for key in keys}
    os.environ.update({key: env[key] for key in keys})
    hatchet_client.reset_for_tests(None)
    ingest_hatchet._declared = None
    worker = subprocess.Popen(  # noqa: S603 - our own module, with our own interpreter
        [sys.executable, "-m", "agent_testing.hatchet_page_fan_out_worker", str(directory)], env=env
    )
    try:
        _wait_for_worker()
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


def _wait_for_worker() -> None:
    deadline = time.monotonic() + _WAIT_SECONDS
    while True:
        try:
            job = _start("text")
            break
        except Exception:  # noqa: BLE001 - not registered yet
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    _until(lambda: _run_status(job) == "COMPLETED", what="the worker to take a first run")


def _start(prefix: str) -> str:
    from agent_testing import hatchet_engine_worker as scripted

    from agent.knowledge import ingest_hatchet
    from agent.knowledge import ingest_status_store

    job_id = f"{prefix}-{uuid.uuid4().hex[:6]}"
    ingest_status_store.put(scripted.status(job_id, organization_id="org-fan-out"))
    payload = scripted.payload(job_id, "org-fan-out")
    assert ingest_hatchet.trigger(job_id, "org-fan-out", "interactive", payload, document_id=job_id)
    return job_id


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


def _events(directory: Path, job: str) -> list[tuple[str, str, int, float, float]]:
    path = directory / "events.log"
    lines = path.read_text().splitlines() if path.exists() else []
    rows = [line.split() for line in lines]
    return [(step, page, int(attempt), float(a), float(b)) for step, j, page, attempt, a, b in rows if j == job]


def test_a_document_runs_every_step_and_its_pages_as_tasks_of_their_own(engine):
    job = _start("pages5")

    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete")

    events = _events(engine, job)
    steps = [step for step, *_ in events]
    assert sorted(page for step, page, *_ in events if step == "page") == ["1", "2", "3", "4", "5"]
    assert steps.index("extract") < min(i for i, step in enumerate(steps) if step == "page")
    assert {"enrich-summary", "enrich-tags", "enrich-topics", "enrich-dossier", "permit", "write"} <= set(steps)
    # The enrichment runs after the last page: the write sits between them.
    last_page = max(end for step, _, _, _, end in events if step == "page")
    assert all(start >= last_page for step, _, _, start, _ in events if step.startswith("enrich-"))


def test_a_page_that_fails_is_tried_again_alone(engine):
    job = _start("flaky4")

    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete", seconds=_WAIT_SECONDS + 60)

    attempts = {page: attempt for step, page, attempt, *_ in _events(engine, job) if step == "page"}
    assert attempts == {"1": 1, "2": 2, "3": 1, "4": 1}


def test_a_file_with_no_page_to_read_skips_the_fan_out_and_is_still_written(engine):
    job = _start("text")

    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete")

    steps = [step for step, *_ in _events(engine, job)]
    assert "page" not in steps and "write" in steps


def test_page_tasks_never_run_past_the_fleet_cap(engine):
    job = _start("pages8")

    _until(lambda: _run_status(job) == "COMPLETED", what="the run to complete", seconds=_WAIT_SECONDS + 60)

    pages = [(start, end) for step, _, _, start, end in _events(engine, job) if step == "page"]
    edges = sorted([(start, 1) for start, _ in pages] + [(end, -1) for _, end in pages])
    running = peak = 0
    for _, step in edges:
        running += step
        peak = max(peak, running)
    assert len(pages) == 8
    assert peak <= FLEET_CAP, "the worker had eight slots; the named fleet limit holds page tasks to two"
