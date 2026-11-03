"""``ingest-document`` in steps and its ``read-page`` tasks, as we hand them to Hatchet (ADR-0151).

No engine here (``agent_testing.hatchet_fake`` records the declaration); what an
engine does with it is ``test_ingest_page_fan_out_engine.py``'s. These pin the
shape: which limits sit where, which step waits durably, what a page attempt
does with a page that fails, and which shape a trigger and a pool pick.
"""

from __future__ import annotations

import asyncio
import inspect

import pytest
from agent_testing import hatchet_fake
from agent_testing.hatchet_fake import FakeContext
from hatchet_sdk import ConcurrencyLimitStrategy

from agent.common import hatchet_client
from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_steps
from agent.knowledge.ingest_hatchet import IngestDocumentInput
from agent.knowledge.ingest_steps import ReadPageInput

ENRICH_STEPS = [f"enrich-{name}" for name in ingest_steps.ENRICHMENTS]


@pytest.fixture
def hatchet(monkeypatch):
    fake = hatchet_fake.install()
    monkeypatch.setattr(ingest_hatchet, "_declared", None)
    monkeypatch.setenv("INGEST_PAGE_FAN_OUT", "on")
    yield fake
    hatchet_client.reset_for_tests(None)


def _run() -> IngestDocumentInput:
    return IngestDocumentInput(job_id="job-1", organization_id="org-1", document_id="doc-1", payload="sealed")


def _steps(hatchet) -> hatchet_fake.FakeWorkflow:
    ingest_hatchet.ingest_workflow()
    return next(w for w in hatchet.workflows if w.steps and w.steps[0].name == ingest_hatchet.EXTRACT_STEP)


def test_the_steps_keep_the_tenant_scoped_limits_on_the_two_that_work_never_on_the_workflow(hatchet):
    workflow = _steps(hatchet)

    assert workflow.options["name"] == "ingest-document"
    # The engine refuses a tenant-scoped limit at the level of a workflow of several tasks.
    assert "concurrency" not in workflow.options
    for name in (ingest_hatchet.EXTRACT_STEP, ingest_hatchet.ASSEMBLE_STEP):
        limits = workflow.step(name).options["concurrency"]
        assert [c.name for c in limits] == [ingest_hatchet.ORG_LIMIT, ingest_hatchet.SUPERSEDE_LIMIT]
        assert [c.name for c in limits] == [c.name for c in ingest_hatchet.concurrency()]
        assert all(c.is_tenant_scoped for c in limits)
    assert workflow.options["idempotency"].key_expression == "input.job_id"
    assert workflow.options["input_validator"] is IngestDocumentInput


def test_the_steps_run_in_the_order_the_design_names(hatchet):
    workflow = _steps(hatchet)
    parents = {step.name: [p.name for p in step.options.get("parents", [])] for step in workflow.steps}

    assert parents[ingest_hatchet.READ_PAGES_STEP] == ["extract"]
    assert parents[ingest_hatchet.ASSEMBLE_STEP] == ["extract", "read-pages"]
    for name in ENRICH_STEPS:
        assert parents[name] == ["extract", "assemble-write"]
    assert parents[ingest_hatchet.PERMIT_STEP] == ["extract", "enrich-tags"]
    assert sorted(parents[ingest_hatchet.WRITE_ROWS_STEP]) == sorted(["extract", *ENRICH_STEPS])
    assert parents["settle"] == ["enrich-write", "enrich-permit"]
    assert any(step.on_failure and step.name == "settle-failed" for step in workflow.steps)


def test_the_fan_out_parent_waits_durably_so_it_never_holds_a_slot_its_pages_need(hatchet):
    workflow = _steps(hatchet)
    read_pages = workflow.step(ingest_hatchet.READ_PAGES_STEP)

    assert read_pages.durable
    assert all(not step.durable for step in workflow.steps if step is not read_pages)
    assert inspect.iscoroutinefunction(read_pages.fn)


def test_read_pages_starts_one_task_per_page_and_returns_counts_only(hatchet):
    workflow = _steps(hatchet)
    read_pages = workflow.step(ingest_hatchet.READ_PAGES_STEP)
    pages = [{"page": 1, "kind": "drawing"}, {"page": 7, "kind": "transcribe"}]
    ctx = FakeContext(outputs={"extract": {"fan_out": True, "content_hash": "h", "pages": pages}})

    result = asyncio.run(read_pages.fn(_run(), ctx))

    [items] = ingest_hatchet.read_page_task().bulk
    started = [(item["input"].page, item["input"].kind, item["input"].content_hash) for item in items]
    assert started == [(1, "drawing", "h"), (7, "transcribe", "h")]
    assert all(item["input"].payload == "sealed" and item["key"].startswith("job-1:") for item in items)
    assert result == {"pages": 2, "read": 2, "not_read": 0, "stored": 2}


def test_page_tasks_hold_the_fleet_cap_and_take_the_organizations_in_turn(hatchet):
    from knowledge_layer.llamaindex.vision_calls import VLM_FLEET_CONCURRENCY

    task = ingest_hatchet.read_page_task()
    fleet, org = task.options["concurrency"]

    assert task.options["name"] == "read-page"
    assert (fleet.name, fleet.expression) == ("ingest-page-read-fleet", "'fleet'")
    assert fleet.max_runs == VLM_FLEET_CONCURRENCY
    assert (org.name, org.expression) == ("ingest-page-read-org", "input.organization_id")
    for limit in (fleet, org):
        assert limit.is_tenant_scoped and limit.limit_strategy == ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN
    assert task.options["retries"] == ingest_hatchet.READ_PAGE_RETRIES


def _page_input() -> ReadPageInput:
    return ReadPageInput(job_id="job-1", organization_id="o", page=3, kind="transcribe", content_hash="h", payload="")


def test_a_page_that_fails_is_tried_again_and_on_its_last_attempt_is_recorded_unread(monkeypatch):
    from knowledge_layer.llamaindex.read_page import PageNotRead

    seen: list[bool] = []

    def read_page(payload, *, page, kind, content_hash, final):
        seen.append(final)
        if not final:
            raise PageNotRead("model_failed")
        return {"page": page, "read": False, "reason": "model_failed", "stored": True}

    monkeypatch.setattr(ingest_steps, "read_page", read_page)

    with pytest.raises(RuntimeError, match="tried again"):
        ingest_hatchet.read_page_attempt(_page_input(), FakeContext(attempt=1, max_attempts=3))
    result = ingest_hatchet.read_page_attempt(_page_input(), FakeContext(attempt=3, max_attempts=3))

    assert seen == [False, True]
    assert result == {"page": 3, "read": False, "reason": "model_failed", "stored": True}


def test_a_trigger_starts_the_shape_the_switch_names_and_a_heavy_file_keeps_its_own(hatchet, monkeypatch):
    from agent.knowledge import ingest_run_hold

    monkeypatch.setattr(ingest_run_hold, "hold", lambda *a, **k: None)
    monkeypatch.setenv("INGEST_PAGE_FAN_OUT", "off")
    ingest_hatchet.trigger("job-off", "org-1", "interactive", "sealed", document_id="doc-1")
    monkeypatch.setenv("INGEST_PAGE_FAN_OUT", "on")
    ingest_hatchet.trigger("job-on", "org-1", "interactive", "sealed", document_id="doc-2")
    ingest_hatchet.trigger("job-heavy", "org-1", "interactive", "sealed", document_id="doc-3", byte_size=10**10)

    started = {
        (w.options["name"], w.steps[0].name): [run.input.job_id for run in w.runs] for w in hatchet.workflows if w.runs
    }
    assert started == {
        ("ingest-document", "index"): ["job-off"],
        ("ingest-document", "extract"): ["job-on"],
        ("ingest-document-heavy", "index"): ["job-heavy"],
    }


def test_each_pool_serves_its_own_workflows(hatchet, monkeypatch):
    def names(pool: str) -> list[str]:
        return [w.options["name"] for w in ingest_hatchet.served_workflows(pool)]

    monkeypatch.setenv("INGEST_PAGE_FAN_OUT", "off")
    assert names("standard") == ["ingest-document"]
    monkeypatch.setenv("INGEST_PAGE_FAN_OUT", "on")
    assert names("standard") == ["ingest-document", "read-page"]
    assert names("page-read") == ["read-page"]
    assert names("highmem") == ["ingest-document-heavy"]


def test_the_page_read_pool_starts_its_own_worker_with_its_own_slots(hatchet, monkeypatch):
    monkeypatch.setenv("INGEST_PAGE_READ_SLOTS", "12")

    ingest_hatchet.serve(lambda: None, lambda payload: None, slots=2, pool=ingest_hatchet.PAGE_READ_POOL)

    [worker] = hatchet.workers
    assert (worker.name, worker.slots, worker.labels) == ("ingest-page-reader", 12, {"pool": "page-read"})
    assert [w.options["name"] for w in worker.workflows] == ["read-page"]


def test_the_assembly_output_always_says_whether_the_enrichment_waits_for_its_steps(monkeypatch):
    """The enrichment steps skip on ``output.enrichment_stored == 0``, so the key is there on every path."""
    monkeypatch.setattr(ingest_hatchet, "execute", lambda run, ctx, scope=None: {"job_id": run.job_id, "status": "ok"})

    output = ingest_hatchet.assemble_attempt(_run(), FakeContext(), {"fan_out": False, "content_hash": None})

    assert output == {"job_id": "job-1", "status": "ok", "answers": 0, "pages_read_here": 0, "enrichment_stored": 0}


def test_the_step_module_imports_no_sdk():
    import ast
    from pathlib import Path

    tree = ast.parse(Path(ingest_steps.__file__).read_text())
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported |= {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
    assert not any(name.startswith("hatchet_sdk") for name in imported)
