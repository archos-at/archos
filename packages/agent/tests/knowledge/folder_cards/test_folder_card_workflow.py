"""The ``folder-cards-*`` tasks as our code hands them to Hatchet, and what each attempt does with the builder.

No engine here (``agent_testing.orchestrator_fake``): the declaration, the trigger and each
task's function, called as a worker calls it. ``test_folder_card_workflow_engine.py`` runs the
same on a real engine.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from agent_testing import orchestrator_fake
from agent_testing.folder_cards import FakeModel
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import NonRetryableException

from agent.common.task_failures import TransientTaskError
from agent.knowledge import factory
from agent.knowledge import ingest_workflow
from agent.knowledge.folder_cards import queue
from agent.knowledge.folder_cards import worker
from agent.knowledge.folder_cards import workflow

ORG = "org_1"


@pytest.fixture
def hatchet(monkeypatch):
    fake = orchestrator_fake.install_for(monkeypatch)
    monkeypatch.setattr(workflow, "_declared", None)
    return fake


def _declared(hatchet):
    build, sweep, reconcile = workflow.workflows()
    return build, sweep, reconcile


def _run_input(collection="proj"):
    return workflow.FolderCardsBuildInput(collection=collection, organization_id=ORG)


class TestDeclaration:
    def test_one_live_build_per_collection_is_the_engines_idempotency_key(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)

        assert build.options["name"] == "folder-cards-build"
        assert build.options["idempotency"].key_expression == "input.collection"

    def test_an_organization_builds_one_collection_at_a_time_and_the_organizations_take_turns(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)

        (limit,) = build.step("build").options["concurrency"]
        assert (limit.expression, limit.max_runs) == ("input.organization_id", 1)
        assert limit.limit_strategy == ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN

    def test_the_build_is_retried_with_a_backoff_and_outlasts_the_builders_own_budget(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)

        options = build.step("build").options
        assert options["retries"] == 2 and options["backoff_factor"] > 1
        assert options["execution_timeout"] > timedelta(seconds=worker.RUN_BUDGET_SECONDS)
        # The claim queue's reclaim window, after which it built a folder a second time.
        assert options["execution_timeout"] > timedelta(seconds=900)

    def test_a_run_that_failed_for_good_has_a_handler(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)

        assert build.step("give-up").on_failure

    def test_the_sweep_runs_every_minute_and_the_reconcile_every_night(self, hatchet):
        _build, sweep, reconcile = _declared(hatchet)

        assert sweep.options["on_crons"] == ["* * * * *"]
        assert reconcile.options["on_crons"] == [workflow.RECONCILE_CRON]
        # A sweep that found no worker is dropped before the next one is due.
        assert sweep.step("sweep").options["schedule_timeout"] < timedelta(minutes=1)

    def test_the_run_carries_ids_and_nothing_a_person_wrote(self):
        assert set(workflow.FolderCardsBuildInput.model_fields) == {"collection", "organization_id"}

    def test_the_standard_ingest_worker_serves_them_on_durable_slots_of_their_own(self, hatchet, monkeypatch):
        monkeypatch.setattr(ingest_workflow, "_declared", None)

        ingest_workflow.serve(
            lambda: None, lambda payload: None, slots=2, also=workflow.workflows(), durable_slots=workflow.WORKER_SLOTS
        )

        (served,) = hatchet.workers
        assert [w.options["name"] for w in served.workflows] == [
            "ingest-document",
            "folder-cards-build",
            "folder-cards-sweep",
            "folder-cards-reconcile",
        ]
        assert (served.slots, served.durable_slots) == (2, workflow.WORKER_SLOTS)


class TestTrigger:
    def test_it_starts_a_run_with_the_collection_and_the_organization(self, hatchet):
        assert workflow.trigger("proj", ORG) is True

        (run,) = hatchet.workflow_runs
        assert run.input == _run_input()
        assert {"collection": "proj", "organization_id": ORG}.items() <= run.additional_metadata.items()

    def test_a_second_trigger_while_a_run_is_live_starts_nothing(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)
        build.refuse_with = IdempotencyCollisionError("run-1")

        assert workflow.trigger("proj", ORG) is False
        assert hatchet.workflow_runs == []

    def test_an_engine_that_is_away_raises(self, hatchet):
        build, _sweep, _reconcile = _declared(hatchet)
        build.refuse_with = ConnectionError("no engine")

        with pytest.raises(ConnectionError):
            workflow.trigger("proj", ORG)


@pytest.fixture
def project(agent_db, bff, monkeypatch):
    monkeypatch.setattr(queue, "QUIET_SECONDS", 0)
    for name in ("Bescheid 1.pdf", "Bescheid 2.pdf", "Bescheid 3.pdf"):
        factory.register_summary("proj", name, "Ein Bescheid.")
        factory.set_document_folder_path("proj", name, "Behörde")
    bff.folders.add(("proj", "Behörde"))
    return bff


def _paths():
    return [path for path, _dirty, _marked in queue.queued("proj")]


def _model(monkeypatch, reply=None):
    model = FakeModel(reply)
    monkeypatch.setattr(worker, "summary_llm", lambda: model)
    return model


def _down(prompt):
    raise RuntimeError("provider down: Behörde")


class TestBuildStep:
    async def test_an_attempt_builds_the_collection_and_reports_counts_only(self, project, monkeypatch):
        _model(monkeypatch)

        output = await workflow.build_step(_run_input(), orchestrator_fake.FakeContext())

        assert output == {"collection": "proj", "outcomes": {"fresh": 1}}
        assert _paths() == []

    async def test_a_failed_folder_fails_the_attempt_so_the_engine_tries_again(self, project, monkeypatch):
        _model(monkeypatch, _down)

        with pytest.raises(TransientTaskError) as raised:
            await workflow.build_step(_run_input(), orchestrator_fake.FakeContext(attempt=1))

        assert _paths() == ["Behörde"]
        # What Hatchet stores of it: a class and a category, never the message or the folder.
        assert "Behörde" not in str(raised.value) and raised.value.__cause__ is None
        assert not isinstance(raised.value, NonRetryableException)

    async def test_the_retry_builds_it(self, project, monkeypatch):
        _model(monkeypatch, _down)
        with pytest.raises(TransientTaskError):
            await workflow.build_step(_run_input(), orchestrator_fake.FakeContext(attempt=1))
        _model(monkeypatch)

        output = await workflow.build_step(_run_input(), orchestrator_fake.FakeContext(attempt=2))

        assert output["outcomes"] == {"fresh": 1}
        assert _paths() == []

    async def test_the_last_attempt_gives_the_folder_up_and_ends_well(self, project, monkeypatch):
        _model(monkeypatch, _down)

        output = await workflow.build_step(_run_input(), orchestrator_fake.FakeContext(attempt=3, max_attempts=3))

        assert output["outcomes"] == {"failed": 1}
        assert _paths() == []

    async def test_a_cancelled_run_starts_no_folder(self, project, monkeypatch):
        model = _model(monkeypatch)

        await workflow.build_step(_run_input(), orchestrator_fake.FakeContext(cancelled=True))

        assert model.calls == []
        assert _paths() == ["Behörde"]

    def test_the_failure_handler_makes_the_folders_wait_again(self, project, monkeypatch):
        assert workflow.give_up_step(_run_input()) == {"collection": "proj", "deferred": 1}

        monkeypatch.setattr(queue, "QUIET_SECONDS", 600)
        assert queue.due("proj") == [] and _paths() == ["Behörde"]


class TestSweepStep:
    async def test_it_starts_a_run_for_the_due_collection_and_none_while_that_run_is_live(
        self, project, hatchet, monkeypatch
    ):
        _model(monkeypatch)

        assert await workflow.sweep_step() == {"started": 1}
        (run,) = hatchet.workflow_runs
        assert run.input == _run_input()

        _declared(hatchet)[0].refuse_with = IdempotencyCollisionError(run.workflow_run_id)
        assert await workflow.sweep_step() == {"started": 0}

    async def test_the_reconcile_marks_what_the_night_found(self, project, monkeypatch):
        _model(monkeypatch)
        await workflow.build_step(_run_input(), orchestrator_fake.FakeContext())
        project.cards[("proj", "Behörde")]["input_hash"] = "outdated"

        assert await workflow.reconcile_step() == {"marked": 1}
        assert _paths() == ["Behörde"]
