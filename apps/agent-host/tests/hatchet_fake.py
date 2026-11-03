"""A stand-in for the Hatchet client, installed at its one seam (``hatchet_client.reset_for_tests``).

It records what the research layer hands the SDK: the workflow it declares,
the runs it starts, the runs it cancels, the worker it starts. No engine is
reachable in tests; ``test_research_hatchet_engine.py`` runs against a real one
when ``HATCHET_CLIENT_TOKEN`` is set.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock


class FakeWorkflow:
    def __init__(self, **declared: Any) -> None:
        self.declared = declared
        self.tasks: dict[str, dict[str, Any]] = {}
        self.started: list[dict[str, Any]] = []

    def task(self, **options: Any):
        def register(fn):
            self.tasks[options["name"]] = {**options, "fn": fn}
            return fn

        return register

    def on_failure_task(self, **options: Any):
        def register(fn):
            self.tasks["on_failure"] = {**options, "fn": fn}
            return fn

        return register

    async def aio_run(self, run, wait_for_result: bool = True, **options: Any):
        assert wait_for_result is False, "a research run is started, never awaited"
        self.started.append({"input": run, **options})
        return SimpleNamespace(workflow_run_id=f"run-{len(self.started)}")


class FakeHatchet:
    def __init__(self) -> None:
        self.workflows: list[FakeWorkflow] = []
        self.runs = SimpleNamespace(aio_cancel=AsyncMock())
        self.workers: list[dict[str, Any]] = []

    def workflow(self, **declared: Any) -> FakeWorkflow:
        workflow = FakeWorkflow(**declared)
        self.workflows.append(workflow)
        return workflow

    def worker(self, name: str, **options: Any):
        started = MagicMock()
        self.workers.append({"name": name, **options, "start": started})
        return SimpleNamespace(start=started)

    @property
    def started(self) -> list[dict[str, Any]]:
        """Every run started on any declared workflow, in order."""
        return [run for workflow in self.workflows for run in workflow.started]
