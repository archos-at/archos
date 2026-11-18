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
from agent.common import status_keys
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.execute import progress
from agent.tools.execute import run
from agent.tools.execute import runner_client

CONVERSATION = "conv-exec-progress"
RUNNER = "http://code-runner:8080"

WRITE_XLSX = 'export default async () => { await writeFile("/workspace/Raumbuch.xlsx", bytes) }'


class _Context:
    def __init__(self, conversation_id: str | None) -> None:
        self.metadata = type("M", (), {"headers": {}})()
        self.conversation_id = conversation_id


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    memory = InMemoryStore()

    async def _backend(conversation_id: str, dsn: str | None = None) -> DraftBackend:
        return DraftBackend(store=memory, conversation_id=conversation_id)

    monkeypatch.setattr(run, "get_draft_backend", _backend)
    return memory


@pytest.fixture(autouse=True)
def _conversation(monkeypatch: pytest.MonkeyPatch) -> None:
    from nat.plugin_api import Context

    monkeypatch.setattr(Context, "get", staticmethod(lambda: _Context(CONVERSATION)))


@pytest.fixture
def registry() -> Any:
    bound = CardRegistry()
    token = set_card_registry(bound)
    yield bound
    reset_card_registry(token)


def _runner(monkeypatch: pytest.MonkeyPatch, answers: list[dict]) -> None:
    queue = iter(answers)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(queue))

    real = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return real(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(runner_client.httpx, "AsyncClient", client)


def _answer(status: str = "ok", files: dict[str, bytes] | None = None, value: Any = None, **extra: Any) -> dict:
    return {
        "status": status,
        "value": value,
        "stdout": "",
        "stderr": extra.get("stderr", ""),
        "files": [
            {"path": path, "base64": base64.b64encode(data).decode("ascii"), "size": len(data)}
            for path, data in (files or {}).items()
        ],
        "durationMs": extra.get("duration", 40),
    }


def _runs(emitted) -> list:
    return [step for step in emitted.steps if step.kind == "status" and step.slot.startswith(progress.SLOT_PREFIX)]


class TestThePlan:
    def test_a_written_path_is_a_write_and_an_input_is_not(self) -> None:
        code = 'await readFile("/workspace/in/Raumliste.xlsx"); await writeFile("/workspace/Raumbuch.xlsx", b)'
        plan = progress.plan_run(code, {"/workspace/in/Raumliste.xlsx"})
        assert plan == progress.RunPlan(writes=("/workspace/Raumbuch.xlsx",))

    def test_reading_back_an_existing_file_is_a_check(self) -> None:
        code = 'const wb = await readFile("/workspace/Raumbuch.xlsx"); return wb.length'
        plan = progress.plan_run(code, {"/workspace/Raumbuch.xlsx"})
        assert (plan.writes, plan.reads) == ((), ("/workspace/Raumbuch.xlsx",))

    def test_writing_an_existing_file_is_an_edit(self) -> None:
        plan = progress.plan_run(WRITE_XLSX, {"/workspace/Raumbuch.xlsx"})
        assert plan.editing == ("/workspace/Raumbuch.xlsx",)

    def test_a_path_held_in_a_variable_still_counts(self) -> None:
        code = 'const out = "/workspace/Bericht.docx"; await writeFile(out, b)'
        assert progress.plan_run(code, set()).writes == ("/workspace/Bericht.docx",)


class TestTheStepTheChatShows:
    async def test_a_new_file_is_announced_by_its_name_and_format_and_finishes_with_it(
        self, store, monkeypatch, registry, emitted
    ) -> None:
        _runner(monkeypatch, [_answer(files={"/workspace/Raumbuch.xlsx": b"PK"}, duration=1200)])

        await run.execute(RUNNER, WRITE_XLSX)

        started, finished = _runs(emitted)
        assert started.id == finished.id
        assert started.key == status_keys.KEY_ACTION_FILE_MAKE
        assert started.values == {"file": "Raumbuch.xlsx", "format": "xlsx"}
        assert started.detail["writes"] == ["Raumbuch.xlsx"]
        assert finished.detail["status"] == "ok"
        assert finished.detail["made"] == ["Raumbuch.xlsx"]
        assert finished.detail["elapsed_ms"] == 1200

    async def test_no_source_and_no_error_text_reaches_the_step(self, store, monkeypatch, registry, emitted) -> None:
        secret = 'const huber = "Mietvertrag Huber"; await writeFile("/workspace/a.docx", b)'
        _runner(monkeypatch, [_answer("error", stderr="TypeError: Huber is not a constructor")])

        await run.execute(RUNNER, secret)

        payload = json.dumps([step.model_dump() for step in _runs(emitted)])
        assert "Huber" not in payload
        assert "TypeError" not in payload
        assert _runs(emitted)[-1].detail["status"] == "error"

    async def test_a_retry_after_a_failure_is_the_same_file_once_more(
        self, store, monkeypatch, registry, emitted
    ) -> None:
        _runner(monkeypatch, [_answer("error"), _answer(files={"/workspace/Raumbuch.xlsx": b"PK"})])

        await run.execute(RUNNER, WRITE_XLSX)
        await run.execute(RUNNER, WRITE_XLSX)

        first, _, second, last = _runs(emitted)
        assert first.id != second.id
        assert (first.key, first.detail["attempt"]) == (status_keys.KEY_ACTION_FILE_MAKE, 1)
        assert (second.key, second.detail["attempt"]) == (status_keys.KEY_ACTION_FILE_RETRY, 2)
        assert last.detail["made"] == ["Raumbuch.xlsx"]

    async def test_an_existing_file_rewritten_is_an_edit(self, store, monkeypatch, registry, emitted) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        await backend.awrite_run_file(f"{DRAFT_ROOT}Raumbuch.xlsx", b"PK1")
        _runner(monkeypatch, [_answer(files={"/workspace/Raumbuch.xlsx": b"PK2"})])

        await run.execute(RUNNER, WRITE_XLSX)

        started, finished = _runs(emitted)
        assert started.key == status_keys.KEY_ACTION_FILE_EDIT
        assert started.detail["editing"] == ["Raumbuch.xlsx"]
        assert (finished.detail["made"], finished.detail["changed"]) == ([], ["Raumbuch.xlsx"])

    async def test_a_calculation_keeps_its_short_result(self, store, monkeypatch, registry, emitted) -> None:
        _runner(monkeypatch, [_answer(value={"summe": 92.87})])

        await run.execute(RUNNER, "export default () => ({ summe: 92.87 })")

        started, finished = _runs(emitted)
        assert started.key == status_keys.KEY_ACTION_CALCULATION
        assert finished.detail["result"] == '{"summe": 92.87}'

    async def test_a_long_result_is_left_to_the_answer(self, store, monkeypatch, registry, emitted) -> None:
        _runner(monkeypatch, [_answer(value={"rows": [1, 2, 3]})])

        await run.execute(RUNNER, "export default () => 1")

        assert "result" not in _runs(emitted)[-1].detail

    async def test_several_files_are_counted(self, store, monkeypatch, registry, emitted) -> None:
        code = 'await writeFile("/workspace/a.docx", x); await writeFile("/workspace/b.pdf", y)'
        _runner(monkeypatch, [_answer(files={"/workspace/a.docx": b"1", "/workspace/b.pdf": b"2"})])

        await run.execute(RUNNER, code)

        started, finished = _runs(emitted)
        assert (started.key, started.values) == (status_keys.KEY_ACTION_FILES_MAKE, {"count": "2"})
        assert finished.detail["made"] == ["a.docx", "b.pdf"]

    async def test_a_named_document_is_listed_with_its_id(self, store, monkeypatch, registry, emitted) -> None:
        async def document(name: str, budget: int) -> tuple[str, str, bytes, str | None]:
            return "proj_p1", "Raumliste.xlsx", b"PK", "doc-7"

        monkeypatch.setattr(run, "_document_bytes", document)
        _runner(monkeypatch, [_answer(value=12)])

        await run.execute(RUNNER, "export default () => 12", documents=["Raumliste.xlsx"])

        finished = _runs(emitted)[-1]
        assert (finished.detail["documents"], finished.detail["document_ids"]) == (["Raumliste.xlsx"], ["doc-7"])
        assert finished.detail["result"] == "12"


class TestTheStepTellsTheTruth:
    async def test_a_file_refused_for_its_size_is_a_failure_with_the_reason(
        self, store, monkeypatch, registry, emitted
    ) -> None:
        monkeypatch.setattr("agent.tools.documents.draft_store.MAX_RUN_FILE_BYTES", 1)
        _runner(monkeypatch, [_answer(files={"/workspace/Raumbuch.xlsx": b"PK-too-big"})])

        await run.execute(RUNNER, WRITE_XLSX)

        finished = _runs(emitted)[-1]
        assert finished.detail["made"] == []
        assert finished.detail["failed"] == ["Raumbuch.xlsx"]
        assert finished.detail["failed_reasons"] == [progress.REASON_TOO_LARGE]

    async def test_a_planned_file_the_run_never_wrote_is_a_failure(self, store, monkeypatch, registry, emitted) -> None:
        _runner(monkeypatch, [_answer()])

        await run.execute(RUNNER, WRITE_XLSX)

        finished = _runs(emitted)[-1]
        assert finished.detail["status"] == "ok"
        assert (finished.detail["failed"], finished.detail["failed_reasons"]) == (
            ["Raumbuch.xlsx"],
            [progress.REASON_NOT_WRITTEN],
        )

    async def test_a_template_path_with_an_extension_is_a_file_and_finishes_with_the_kept_name(
        self, store, monkeypatch, registry, emitted
    ) -> None:
        code = 'const name = "Raumbuch"; await writeFile(`/workspace/${name}.xlsx`, bytes)'
        _runner(monkeypatch, [_answer(files={"/workspace/Raumbuch.xlsx": b"PK"})])

        await run.execute(RUNNER, code)

        started, finished = _runs(emitted)
        assert started.key == status_keys.KEY_ACTION_FILE_MAKE
        assert started.values == {"file": "….xlsx", "format": "xlsx"}
        assert finished.detail["made"] == ["Raumbuch.xlsx"]
        assert finished.detail["failed"] == []
