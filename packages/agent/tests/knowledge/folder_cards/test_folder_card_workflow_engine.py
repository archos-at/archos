"""The folder card tasks on a real Hatchet engine: what the claim queue did, now the engine's.

Runs only when ``HATCHET_CLIENT_TOKEN`` and ``HATCHET_CLIENT_HOST_PORT`` name an engine
(CI's ``Hatchet engine tests`` job starts ``hatchet-lite``); skipped otherwise. Each run
gets its own namespace, so it shares the engine with nothing.

One worker process (``agent_testing.folder_cards_engine_worker``) serves the real tasks
beside the ingest workflow, as the standard ingest worker does: one standard slot, where
``agent_testing.orchestrator_engine_worker`` scripts the documents, and the builder's
durable slots. Only one folder's build is scripted. The tests mark folders dirty in the
database both processes share, start runs as the sweep does (or wait for the engine's own
cron), and read the dirty set and the worker's log of each build.
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

_WAIT_SECONDS = 120


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    """A namespace of our own, the agent database both processes share, and the worker serving the tasks."""
    from agent.common import orchestrator_client
    from agent.knowledge import factory
    from agent.knowledge import ingest_status_store
    from agent.knowledge.folder_cards import queue

    directory = tmp_path_factory.mktemp("folder-cards-engine")
    url = f"sqlite:///{directory}/agent.db"
    env = {
        **os.environ,
        "HATCHET_CLIENT_NAMESPACE": f"test_{uuid.uuid4().hex[:8]}",
        "SUMMARY_DB": url,
        "PYTHONPATH": os.pathsep.join(sys.path),
    }
    env.pop("INTERNAL_API_TOKEN", None)
    saved = {key: os.environ.get(key) for key in ("HATCHET_CLIENT_NAMESPACE", "SUMMARY_DB")}
    os.environ.update({key: env[key] for key in saved})
    previous_store, quiet = factory._document_metadata_store, queue.QUIET_SECONDS
    factory.configure_summary_db(url)
    queue.QUIET_SECONDS = 0
    orchestrator_client.reset_for_tests(None)
    process = subprocess.Popen(  # noqa: S603 - our own module, with our own interpreter
        [sys.executable, "-m", "agent_testing.folder_cards_engine_worker", str(directory)], env=env
    )
    try:
        _wait_for_worker(process)
        yield directory
    finally:
        process.terminate()
        process.wait(timeout=60)
        orchestrator_client.reset_for_tests(None)
        ingest_status_store._initialized.discard(url)
        factory._document_metadata_store, queue.QUIET_SECONDS = previous_store, quiet
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _wait_for_worker(process: subprocess.Popen) -> None:
    """The worker has registered once a warm-up build went through it (an unknown workflow's run is dropped)."""
    from agent.knowledge.folder_cards import queue
    from agent.knowledge.folder_cards import workflow

    queue.mark("warm-up", ["ok-warm"], "org-warm")
    deadline = time.monotonic() + _WAIT_SECONDS
    while time.monotonic() < deadline:
        assert process.poll() is None, "the worker process exited"
        try:
            workflow.trigger("warm-up", "org-warm")
        except Exception:  # noqa: BLE001, S110 - the engine or the registration is not there yet
            pass
        if not queue.queued("warm-up"):
            return
        time.sleep(2)
    raise AssertionError("the worker never built the warm-up folder")


def _events(directory: Path, collection: str) -> list[tuple[str, str, int, float]]:
    """``(event, folder path, attempt, seconds)`` of the collection's builds, in order."""
    log = directory / "events.log"
    lines = [line.split("\t") for line in log.read_text().splitlines()] if log.exists() else []
    return [(line[0], line[2], int(line[3]), float(line[4])) for line in lines if line[1] == collection]


def _starts(directory: Path, collection: str, folder: str) -> int:
    return sum(1 for event, path, *_ in _events(directory, collection) if (event, path) == ("start", folder))


def _until(condition, what: str, seconds: float = _WAIT_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if value := condition():
            return value
        time.sleep(0.25)
    raise AssertionError(f"timed out waiting for {what}")


def _mark(collection: str, folders: list[str], organization: str = "org-a") -> None:
    from agent.knowledge.folder_cards import queue

    queue.mark(collection, folders, organization)


def _dirty(collection: str) -> list[str]:
    from agent.knowledge.folder_cards import queue

    return [path for path, _dirty_since, _marked in queue.queued(collection)]


def test_the_engines_cron_sweeps_a_due_collection_and_builds_children_first(engine):
    _mark("cron", ["ok-parent/ok-child"])

    _until(lambda: not _dirty("cron"), "the sweep to start the build", seconds=150)

    built = [path for event, path, *_ in _events(engine, "cron") if event == "start"]
    assert built == ["ok-parent/ok-child", "ok-parent"]


def test_a_second_trigger_while_a_build_runs_starts_nothing(engine):
    from agent.knowledge.folder_cards import workflow

    _mark("twice", ["slow-a"])

    workflow.trigger("twice", "org-a")  # the cron's sweep may have been first; either way one run is live
    _until(lambda: _starts(engine, "twice", "slow-a"), "the build to start")
    assert workflow.trigger("twice", "org-a") is False
    _until(lambda: not _dirty("twice"), "the build to end")

    assert _starts(engine, "twice", "slow-a") == 1


def test_a_failed_build_is_retried_by_the_engine_and_the_run_stays_live_meanwhile(engine):
    from agent.knowledge.folder_cards import workflow

    _mark("retry", ["flaky-a"])

    workflow.trigger("retry", "org-b")
    _until(lambda: ("end", "flaky-a", 1) in [e[:3] for e in _events(engine, "retry")], "the first attempt to fail")
    assert workflow.trigger("retry", "org-b") is False  # waiting out its backoff, the run is still the one run
    _until(lambda: not _dirty("retry"), "the second attempt to build it")

    assert _starts(engine, "retry", "flaky-a") == 2


def test_a_build_that_fails_on_every_attempt_is_given_up_on_the_last(engine):
    from agent.knowledge.folder_cards import workflow

    _mark("poison", ["bad-a", "ok-b"])

    workflow.trigger("poison", "org-c")
    _until(lambda: not _dirty("poison"), "the last attempt to give the folder up")

    assert _starts(engine, "poison", "bad-a") == workflow.RETRIES + 1
    assert _starts(engine, "poison", "ok-b") == 1  # built on the first attempt, never again


def test_an_organization_builds_one_collection_at_a_time(engine):
    from agent.knowledge.folder_cards import workflow

    _mark("fair-1", ["slow-a"], "org-d")
    _mark("fair-2", ["slow-a"], "org-d")

    workflow.trigger("fair-1", "org-d")
    workflow.trigger("fair-2", "org-d")
    _until(lambda: not _dirty("fair-1") and not _dirty("fair-2"), "both builds to end")

    spans = sorted((start[3], end[3]) for start, end in (_events(engine, "fair-1")[:2], _events(engine, "fair-2")[:2]))
    assert spans[0][1] <= spans[1][0], "the organization's second build started before its first ended"


def _documents(directory: Path, event: str) -> list[float]:
    """When the scripted ingestor logged ``event`` for a slow document, in order."""
    log = directory / "ingest-events.log"
    lines = [line.split() for line in log.read_text().splitlines()] if log.exists() else []
    return [float(line[3]) for line in lines if line[0] == event and line[1].startswith("slow-")]


def test_a_build_neither_waits_for_the_document_slot_nor_takes_it(engine):
    """The worker has one standard slot. Two documents hold it in turn; the build runs beside both."""
    from agent_testing import orchestrator_engine_worker as scripted

    from agent.knowledge import ingest_status_store
    from agent.knowledge import ingest_workflow
    from agent.knowledge.folder_cards import workflow

    _mark("beside", ["slow-a"], "org-e")
    for _document in range(2):
        job = f"slow-{uuid.uuid4().hex[:6]}"
        ingest_status_store.put(scripted.status(job, organization_id="org-e"))
        assert ingest_workflow.trigger(job, "org-e", "interactive", scripted.payload(job, "org-e"))
    _until(lambda: _documents(engine, "start"), "the first document to take the slot")

    workflow.trigger("beside", "org-e")
    _until(lambda: not _dirty("beside") and len(_documents(engine, "end")) == 2, "the build and both documents")

    (build_start, build_end) = (event[3] for event in _events(engine, "beside")[:2])
    assert build_start < _documents(engine, "end")[0], "the build waited for the document slot"
    assert _documents(engine, "start")[1] < build_end, "the second document waited for the build"
