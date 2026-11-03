"""A stand-in for the Hatchet client, installed at its one fake point (``hatchet_client.reset_for_tests``).

No engine is reachable in a test run, so a test asserts what OUR code hands the
SDK: the workflow's declaration and its steps, each run's input, metadata and
priority, the runs it cancels, the worker it starts. The fake records those and
runs nothing; a test calls a step's function itself.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common import hatchet_client


@dataclass
class FakeRun:
    input: Any
    additional_metadata: dict[str, Any]
    priority: int | None
    workflow_run_id: str


@dataclass
class FakeStep:
    """A step as ``Workflow.task`` (or ``on_failure_task``) declared it."""

    options: dict[str, Any]
    fn: Any
    on_failure: bool = False

    @property
    def name(self) -> str:
        return self.options.get("name") or self.fn.__name__

    def __call__(self, *args, **kwargs):
        return self.fn(*args, **kwargs)


@dataclass
class FakeWorkflow:
    """A workflow as ``Hatchet.workflow`` declared it, its steps, and the runs started of it."""

    options: dict[str, Any]
    steps: list[FakeStep] = field(default_factory=list)
    runs: list[FakeRun] = field(default_factory=list)
    #: Raised by the next ``run`` instead of starting one, when set.
    refuse_with: BaseException | None = None
    _ids: Any = field(default_factory=lambda: itertools.count(1))

    def run(self, input=None, options=None, wait_for_result=True, additional_metadata=None, priority=None, **_):
        assert wait_for_result is False, "a dispatch never waits for its run"
        if self.refuse_with is not None:
            raise self.refuse_with
        run = FakeRun(input, dict(additional_metadata or {}), priority, f"run-{next(self._ids)}")
        self.runs.append(run)
        return run

    def task(self, **options):
        return self._declare(options, on_failure=False)

    def on_failure_task(self, **options):
        return self._declare(options, on_failure=True)

    def _declare(self, options: dict[str, Any], *, on_failure: bool):
        def declare(fn):
            step = FakeStep(options, fn, on_failure)
            self.steps.append(step)
            return step

        return declare

    def step(self, name: str) -> FakeStep:
        return next(step for step in self.steps if step.name == name)


class FakeRuns:
    def __init__(self) -> None:
        self.cancelled: list[str] = []
        self.refuse_with: BaseException | None = None

    def cancel(self, run_id: str) -> None:
        if self.refuse_with is not None:
            raise self.refuse_with
        self.cancelled.append(run_id)


@dataclass
class FakeWorker:
    name: str
    slots: int | None
    workflows: list[Any]
    lifespan: Any
    started: bool = False

    def start(self) -> None:
        self.started = True


class FakeHatchet:
    """What ``hatchet_sdk.Hatchet`` offers that our code calls."""

    def __init__(self) -> None:
        self.workflows: list[FakeWorkflow] = []
        self.runs = FakeRuns()
        self.workers: list[FakeWorker] = []

    def workflow(self, **options) -> FakeWorkflow:
        workflow = FakeWorkflow(options)
        self.workflows.append(workflow)
        return workflow

    def worker(self, name, slots=None, durable_slots=None, labels=None, workflows=None, lifespan=None):
        worker = FakeWorker(name, slots, list(workflows or []), lifespan)
        self.workers.append(worker)
        return worker

    @property
    def workflow_runs(self) -> list[FakeRun]:
        return [run for workflow in self.workflows for run in workflow.runs]


def install() -> FakeHatchet:
    """Install a fresh fake as the process's client; ``hatchet_client.reset_for_tests(None)`` removes it."""
    fake = FakeHatchet()
    hatchet_client.reset_for_tests(fake)  # type: ignore[arg-type]
    return fake


class FakeContext:
    """The ``Context`` a task function gets: the attempt, and whether the run was cancelled."""

    def __init__(self, *, attempt: int = 1, max_attempts: int = 3, cancelled: bool = False) -> None:
        self.attempt_number = attempt
        self.max_attempts = max_attempts
        self.is_cancelled = cancelled


def install_for(monkeypatch) -> FakeHatchet:
    """A fresh fake for one test, undone with it, and the payload key a hand-over needs."""
    import base64

    from agent.knowledge import ingest_hatchet

    monkeypatch.setenv("JOB_PAYLOAD_KEK", base64.b64encode(b"k" * 32).decode())
    fake = FakeHatchet()
    monkeypatch.setattr(hatchet_client, "_client", fake)
    monkeypatch.setattr(ingest_hatchet, "_declared", None)
    return fake


def waiting_runs() -> list[FakeRun]:
    """The runs started that no worker has taken and nobody cancelled, oldest first."""
    fake = hatchet_client.client()
    gone = {*getattr(fake, "taken", set()), *fake.runs.cancelled}
    return [run for run in fake.workflow_runs if run.workflow_run_id not in gone]


def take_run(job_id: str | None = None) -> FakeRun | None:
    """The next waiting run (of ``job_id``, when given), now taken; None when nothing waits."""
    runs = [run for run in waiting_runs() if job_id is None or run.input.job_id == job_id]
    if not runs:
        return None
    fake = hatchet_client.client()
    fake.taken = {*getattr(fake, "taken", set()), runs[0].workflow_run_id}
    return runs[0]
