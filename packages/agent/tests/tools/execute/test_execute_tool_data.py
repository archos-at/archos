from __future__ import annotations

import base64
import json
from typing import Any

import httpx
import pytest
from langgraph.store.memory import InMemoryStore

from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common.turn_status import step_scope
from agent.tools.bim import measure_register
from agent.tools.bim import register as query_register
from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.execute import progress
from agent.tools.execute import run
from agent.tools.execute import runner_client
from agent.tools.execute import tool_data
from agent.tools.workspace import register as workspace_register
from agent.tools.workspace.client import ToolResult

CONVERSATION = "conv-data-1"
RUNNER = "http://code-runner:8080"
ROOMS = 312


class _Context:
    def __init__(self, conversation_id: str | None) -> None:
        self.metadata = type("M", (), {"headers": {}})()
        self.conversation_id = conversation_id


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    from nat.plugin_api import Context

    memory = InMemoryStore()

    async def _store(dsn: str | None = None) -> InMemoryStore:
        return memory

    async def _backend(conversation_id: str, dsn: str | None = None) -> DraftBackend:
        return DraftBackend(store=memory, conversation_id=conversation_id)

    monkeypatch.setattr(draft_store, "get_draft_store", _store)
    monkeypatch.setattr(run, "get_draft_backend", _backend)
    monkeypatch.setattr(Context, "get", staticmethod(lambda: _Context(CONVERSATION)))
    monkeypatch.setattr(query_register, "get_organization_id_from_context", lambda: "org-1")
    monkeypatch.setattr(query_register, "get_project_id_from_context", lambda: "proj-1")
    monkeypatch.setattr(measure_register, "get_organization_id_from_context", lambda: "org-1")
    monkeypatch.setattr(measure_register, "get_project_id_from_context", lambda: "proj-1")
    return memory


@pytest.fixture
def steps(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    emitted: list[Any] = []
    monkeypatch.setattr(progress.turn_status, "emit_step", lambda step, started=False: emitted.append(step))
    registry = CardRegistry()
    token = set_card_registry(registry)
    yield emitted
    reset_card_registry(token)


def _schedule(rooms: int = ROOMS) -> dict[str, Any]:
    storeys = [
        {
            "storeyName": name,
            "netFloorArea": None,
            "rooms": [
                {"globalId": f"R{index:04d}", "name": f"{name} Raum {index}", "netFloorArea": 10 + index / 100}
                for index in range(start, rooms, 3)
            ],
        }
        for start, name in enumerate(("EG", "OG1", "OG2"))
    ]
    return {
        "resolved": True,
        "op": "schedule",
        "model": {"filename": "Wohnbau.ifc"},
        "summary": f"{rooms} rooms",
        "schedule": {"units": {"area": "m²"}, "storeys": storeys},
    }


async def _schedule_line(monkeypatch: pytest.MonkeyPatch, result: dict[str, Any] | None = None) -> str:
    monkeypatch.setattr(query_register, "run_bim_query", lambda **_: result or _schedule())
    answer = await query_register._query(query_register.IfcQueryInput(operation="schedule"), 25)
    return answer.splitlines()[-1]


def _runner(monkeypatch: pytest.MonkeyPatch, seen: list[dict]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(
            200, json={"status": "ok", "value": 1, "stdout": "", "stderr": "", "files": [], "durationMs": 9}
        )

    real = httpx.AsyncClient
    monkeypatch.setattr(
        runner_client.httpx, "AsyncClient", lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs)
    )


def _sent(body: dict) -> dict[str, bytes]:
    return {entry["path"]: base64.b64decode(entry["base64"]) for entry in body["files"]}


class TestAToolNamesItsResult:
    async def test_a_room_schedule_names_a_reference_with_its_count(self, store, monkeypatch) -> None:
        line = await _schedule_line(monkeypatch)

        assert line.startswith(f"Data for execute: r1 ({ROOMS} rooms, ")
        assert 'execute(data=["r1"])' in line
        assert "/workspace/in/ifc_query-r1.json" in line

    async def test_references_count_up_in_one_conversation(self, store, monkeypatch) -> None:
        await _schedule_line(monkeypatch)

        assert (await _schedule_line(monkeypatch)).startswith("Data for execute: r2 ")

    async def test_deep_research_has_no_execute_so_nothing_is_named(self, store, monkeypatch) -> None:
        with step_scope("deep"):
            line = await _schedule_line(monkeypatch)

        assert "Data for execute" not in line
        assert store.search(tool_data.data_namespace(CONVERSATION)) == []

    async def test_a_store_that_fails_leaves_the_tool_answer_standing(self, store, monkeypatch) -> None:
        async def _down(dsn: str | None = None) -> InMemoryStore:
            raise ConnectionError("store is down")

        monkeypatch.setattr(draft_store, "get_draft_store", _down)

        line = await _schedule_line(monkeypatch)

        assert "Data for execute" not in line
        assert "EG Raum" in line or "rooms" in line

    async def test_an_overview_is_not_data(self, store, monkeypatch) -> None:
        overview = {"resolved": True, "op": "overview", "model": {"filename": "a.ifc"}, "overview": {}}
        monkeypatch.setattr(query_register, "run_bim_query", lambda **_: overview)

        answer = await query_register._query(query_register.IfcQueryInput(operation="overview"), 25)

        assert "Data for execute" not in answer

    async def test_a_measurement_keeps_its_provenance(self, store, monkeypatch) -> None:
        source = {"resolved": True, "model": {"filename": "Wohnbau.ifc"}}
        answer = {
            "decidable": True,
            "value": 2.61,
            "unit": "m",
            "provenance": "computed",
            "method": "lowest ceiling soffit above the floor slab",
            "tolerance": 0.02,
            "from": ["2O2Fr$t4X7Zf8NOew3FLOH"],
        }
        results = [{"globalId": "R1", "answer": answer}]
        payload = {"summary": {"measured": 1, "of": 1}, "measure": "clearHeight", "results": results}
        monkeypatch.setattr(measure_register, "_run", lambda *_: (source, payload, "h"))

        reply = await measure_register._measure(
            measure_register.IfcMeasureInput(operation="measure", measure="clearHeight", global_id=["R1"]), 50
        )
        assert reply.splitlines()[-1].startswith("Data for execute: r1 (1 results, ")
        stored = json.loads(store.get(tool_data.data_namespace(CONVERSATION), "r1").value["json"])

        assert stored["tool"] == "ifc_measure"
        assert stored["about"] == "Messwerte aus dem Modell"
        assert stored["result"]["payload"] == payload
        [measured] = stored["result"]["measurements"]
        assert measured["method"] == answer["method"]
        assert measured["provenance"] == "computed"
        assert measured["tolerance_text"] == "±0.02 m"
        assert measured["elements"] == [{"global_id": "2O2Fr$t4X7Zf8NOew3FLOH"}]

    async def test_a_workspace_read_hands_over_its_structured_answer(self, store, monkeypatch) -> None:
        facts = {"project": {"name": "Wohnbau Nord", "buildingClass": 4, "storeysAboveGround": 5}}
        monkeypatch.setattr(workspace_register, "_envelope", lambda: object())
        monkeypatch.setattr(
            workspace_register,
            "call_tool_result",
            lambda *_, **__: ToolResult(text="Wohnbau Nord, GK 4", structured=facts, is_error=False),
        )
        monkeypatch.setattr(workspace_register, "_record_read", lambda *_: None)

        text = await workspace_register.run_workspace("call", {"name": "project-profile-get", "input": {}})

        assert "Data for execute: r1 (" in text
        stored = json.loads(store.get(tool_data.data_namespace(CONVERSATION), "r1").value["json"])
        assert stored["result"] == facts
        assert stored["about"] == "Projektprofil"

    async def test_a_workspace_list_is_not_data(self, store, monkeypatch) -> None:
        monkeypatch.setattr(workspace_register, "_envelope", lambda: object())
        monkeypatch.setattr(
            workspace_register,
            "call_tool_result",
            lambda *_, **__: ToolResult(text="[]", structured={"projects": []}, is_error=False),
        )
        monkeypatch.setattr(workspace_register, "_record_read", lambda *_: None)

        assert await workspace_register.run_workspace("call", {"name": "project-list", "input": {}}) == "[]"


class TestExecuteReadsIt:
    async def test_the_referenced_schedule_arrives_as_json_in_the_runner_input(self, store, steps, monkeypatch) -> None:
        await _schedule_line(monkeypatch)
        seen: list[dict] = []
        _runner(monkeypatch, seen)

        report = await run.execute(RUNNER, "export default () => 1", data=["r1"])

        sent = _sent(seen[0])
        document = json.loads(sent["/workspace/in/ifc_query-r1.json"])
        rooms = [room for storey in document["result"]["schedule"]["storeys"] for room in storey["rooms"]]
        assert len(rooms) == ROOMS
        assert rooms[0] == {"globalId": "R0000", "name": "EG Raum 0", "netFloorArea": 10.0}
        assert document["provenance"].startswith("declared")
        assert document["model"] == "Wohnbau.ifc"
        assert document["rows"] == ROOMS
        assert "data read: r1 at /workspace/in/ifc_query-r1.json" in report

    async def test_the_derivation_names_the_input_in_words(self, store, steps, monkeypatch) -> None:
        await _schedule_line(monkeypatch)
        _runner(monkeypatch, [])

        await run.execute(RUNNER, "export default () => 1", data=["r1"])

        detail = steps[-1].detail
        assert detail["documents"] == ["Raumdaten aus dem Modell"]
        assert detail["document_ids"] == [""]
        assert "r1" not in json.dumps(detail)

    async def test_a_result_survives_into_the_next_turn(self, store, monkeypatch) -> None:
        await _schedule_line(monkeypatch)
        seen: list[dict] = []
        _runner(monkeypatch, seen)

        token = set_card_registry(CardRegistry())
        try:
            await run.execute(RUNNER, "export default () => 1", data=["r1"])
        finally:
            reset_card_registry(token)

        assert "/workspace/in/ifc_query-r1.json" in _sent(seen[0])

    async def test_an_unknown_reference_is_refused_with_what_to_do(self, store, monkeypatch) -> None:
        await _schedule_line(monkeypatch)
        seen: list[dict] = []
        _runner(monkeypatch, seen)

        report = await run.execute(RUNNER, "export default () => 1", data=["r7"])

        assert seen == []
        assert report.startswith("Nothing was run. No tool result 'r7' to hand over.")
        assert "This conversation holds r1." in report
        assert "run the tool again" in report

    async def test_a_reference_of_another_conversation_is_unknown_here(self, store, monkeypatch) -> None:
        from nat.plugin_api import Context

        await _schedule_line(monkeypatch)
        monkeypatch.setattr(Context, "get", staticmethod(lambda: _Context("conv-data-2")))
        _runner(monkeypatch, [])

        report = await run.execute(RUNNER, "export default () => 1", data=["r1"])

        assert "No tool result 'r1'" in report
        assert "holds no tool results yet" in report


class TestLimits:
    async def test_only_the_latest_results_are_kept(self, store, monkeypatch) -> None:
        for _ in range(tool_data.MAX_KEPT + 2):
            await _schedule_line(monkeypatch, _schedule(3))

        keys = {item.key for item in store.search(tool_data.data_namespace(CONVERSATION), limit=100)}
        assert keys == {tool_data.INDEX_KEY, *(f"r{n}" for n in range(3, tool_data.MAX_KEPT + 3))}
        _runner(monkeypatch, [])
        report = await run.execute(RUNNER, "export default () => 1", data=["r1"])
        assert f"Only the latest {tool_data.MAX_KEPT} are kept" in report

    async def test_a_result_over_the_size_limit_is_not_kept_and_says_so(self, store, monkeypatch) -> None:
        monkeypatch.setattr(tool_data, "MAX_DATA_BYTES", 1024)

        line = await _schedule_line(monkeypatch)

        assert line.startswith("This result is too large to hand to execute (")
        assert "narrow the query" in line
        assert store.search(tool_data.data_namespace(CONVERSATION)) == []

    async def test_a_run_takes_at_most_ten_results(self, store, monkeypatch) -> None:
        seen: list[dict] = []
        _runner(monkeypatch, seen)

        report = await run.execute(RUNNER, "export default () => 1", data=[f"r{n}" for n in range(1, 12)])

        assert seen == []
        assert "at most 10 tool results; 11 were named" in report

    async def test_data_counts_against_the_inputs_of_a_run(self, store, monkeypatch) -> None:
        await _schedule_line(monkeypatch)
        monkeypatch.setattr(run, "MAX_INPUT_BYTES", 1024)
        seen: list[dict] = []
        _runner(monkeypatch, seen)

        report = await run.execute(RUNNER, "export default () => 1", data=["r1"])

        assert seen == []
        assert "exceed 50 MB" in report
