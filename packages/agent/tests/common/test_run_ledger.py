from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from typing import get_args

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from agent.common.run_ledger import MAX_DOCS_PER_STEP
from agent.common.run_ledger import MAX_INTENT_CHARS
from agent.common.run_ledger import MAX_LOCI_PER_DOC
from agent.common.run_ledger import MAX_NAME_CHARS
from agent.common.run_ledger import MAX_STEPS
from agent.common.run_ledger import RUN_PHASES
from agent.common.run_ledger import RUN_STATUS_MOVES
from agent.common.run_ledger import RUN_STATUSES
from agent.common.run_ledger import TERMINAL_RUN_STATUSES
from agent.common.run_ledger import RunError
from agent.common.run_ledger import RunLedger
from agent.common.run_ledger import RunLedgerDoc
from agent.common.run_ledger import RunPhase
from agent.common.run_ledger import RunPhaseEntry
from agent.common.run_ledger import RunResult
from agent.common.run_ledger import RunStatus
from agent.common.run_ledger import RunStep
from agent.common.run_ledger import next_run_status
from agent.common.run_ledger import to_wire

SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "apps" / "workspace" / "tests" / "fixtures" / "run-ledger.schema.json"
)


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def _validator(schema: dict[str, Any], name: str) -> Draft202012Validator:
    return Draft202012Validator({**schema["$defs"][name], "$defs": schema["$defs"]})


def _ledger() -> RunLedger:
    return RunLedger(
        runId="6f1a0f7e-2b1f-4a4e-9a4e-2f0f1a6d9c31",
        status="done",
        phases=[
            RunPhaseEntry(
                phase="researching",
                startedAt="2026-09-16T08:00:00.000Z",
                endedAt="2026-09-16T08:05:00.000Z",
            ),
            RunPhaseEntry(phase="filed", startedAt="2026-09-16T08:05:00.000Z"),
        ],
        steps=[
            RunStep(
                id="batch-1",
                phase="researching",
                intent="OIB-2 auf Fluchtwegbreiten prüfen",
                startedAt="2026-09-16T08:01:00.000Z",
                docs=[
                    RunLedgerDoc(
                        name="oib-richtlinie-2.pdf",
                        title="OIB-Richtlinie 2 Brandschutz",
                        shelf="baurecht",
                        loci=["Punkt 2.3.1", "S. 12"],
                        repeat=False,
                    )
                ],
                openPoints=["Stiegenhausbreite im Bestand ungeklärt"],
            )
        ],
        result=RunResult(fileId="doc-1", filedAt="2026-09-16T08:06:00.000Z"),
        startedAt="2026-09-16T08:00:00.000Z",
        updatedAt="2026-09-16T08:06:00.000Z",
        finishedAt="2026-09-16T08:06:00.000Z",
    )


class TestTheWire:
    def test_the_fixture_is_where_the_contract_lives(self, schema: dict[str, Any]) -> None:
        assert "runLedger" in schema["$defs"]

    def test_a_built_ledger_validates(self, schema: dict[str, Any]) -> None:
        _validator(schema, "runLedger").validate(to_wire(_ledger()))

    def test_a_fresh_ledger_validates(self, schema: dict[str, Any]) -> None:
        fresh = RunLedger(
            runId="run-1",
            status="created",
            startedAt="2026-09-16T08:00:00.000Z",
            updatedAt="2026-09-16T08:00:00.000Z",
        )
        _validator(schema, "runLedger").validate(to_wire(fresh))

    def test_a_failed_ledger_validates(self, schema: dict[str, Any]) -> None:
        failed = RunLedger(
            runId="run-1",
            status="failed",
            phases=[
                RunPhaseEntry(
                    phase="planning",
                    startedAt="2026-09-16T08:00:00.000Z",
                    endedAt="2026-09-16T08:01:00.000Z",
                )
            ],
            error=RunError(reason="Der Anbieter hat abgebrochen.", completedBefore=["planning"]),
            startedAt="2026-09-16T08:00:00.000Z",
            updatedAt="2026-09-16T08:02:00.000Z",
            finishedAt="2026-09-16T08:02:00.000Z",
        )
        _validator(schema, "runLedger").validate(to_wire(failed))

    def test_the_wire_reads_back_into_the_models(self) -> None:
        assert RunLedger.model_validate(to_wire(_ledger())) == _ledger()

    def test_an_optional_is_absent_and_never_null(self) -> None:
        payload = to_wire(
            RunLedger(
                runId="run-1",
                status="running",
                startedAt="2026-09-16T08:00:00.000Z",
                updatedAt="2026-09-16T08:00:00.000Z",
            )
        )
        assert "result" not in payload and "error" not in payload and "finishedAt" not in payload

    def test_the_append_op_validates(self, schema: dict[str, Any]) -> None:
        body = {
            "op": "append",
            "steps": [to_wire(_ledger().steps[0])],
            "phases": [to_wire(_ledger().phases[0])],
            "status": "running",
        }
        _validator(schema, "runLedgerRequest").validate(body)


class TestTheClosedShape:
    def test_a_step_may_not_name_a_tool(self) -> None:
        with pytest.raises(ValidationError):
            RunStep(
                id="batch-1",
                phase="researching",
                intent="OIB-2 prüfen",
                startedAt="2026-09-16T08:01:00.000Z",
                tool="search_norms",
            )

    def test_the_schema_refuses_it_too(self, schema: dict[str, Any]) -> None:
        step = to_wire(_ledger().steps[0]) | {"tool": "search_norms"}
        assert not _validator(schema, "runLedger").is_valid(to_wire(_ledger()) | {"steps": [step]})

    def test_both_vocabularies_are_the_frontends(self, schema: dict[str, Any]) -> None:
        properties = schema["$defs"]["runLedger"]["properties"]
        assert set(get_args(RunStatus)) == set(properties["status"]["enum"])
        assert set(RUN_STATUSES) == set(properties["status"]["enum"])
        phase_enum = properties["phases"]["items"]["properties"]["phase"]["enum"]
        assert set(get_args(RunPhase)) == set(phase_enum)
        assert set(RUN_PHASES) == set(phase_enum)

    def test_the_status_moves_are_the_frontends(self, schema: dict[str, Any]) -> None:
        lifecycle = schema["x-lifecycle"]
        assert set(TERMINAL_RUN_STATUSES) == set(lifecycle["ended"])
        declared = {state: set(node.get("on", {}).values()) for state, node in lifecycle["states"].items()}
        assert {state: set(targets) for state, targets in RUN_STATUS_MOVES.items()} == declared

    def test_an_ended_status_stays_ended(self) -> None:
        for ended in TERMINAL_RUN_STATUSES:
            assert set(RUN_STATUS_MOVES[ended]) <= set(TERMINAL_RUN_STATUSES)
            assert next_run_status(ended, "running") == ended
        assert next_run_status("failed", "done") == "failed"
        assert next_run_status("done", "interrupted") == "interrupted"
        assert next_run_status("running", "not-a-status") == "running"

    def test_the_bounds_are_the_frontends(self, schema: dict[str, Any]) -> None:
        ledger = schema["$defs"]["runLedger"]["properties"]
        step = ledger["steps"]["items"]["properties"]
        doc = step["docs"]["items"]["properties"]
        assert ledger["steps"]["maxItems"] == MAX_STEPS
        assert step["intent"]["maxLength"] == MAX_INTENT_CHARS
        assert step["docs"]["maxItems"] == MAX_DOCS_PER_STEP
        assert doc["name"]["maxLength"] == MAX_NAME_CHARS
        assert doc["loci"]["maxItems"] == MAX_LOCI_PER_DOC
