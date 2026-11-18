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
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.execute import run
from agent.tools.execute import runner_client

CONVERSATION = "conv-exec-1"
RUNNER = "http://code-runner:8080"


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


def _runner(monkeypatch: pytest.MonkeyPatch, answer: Any, seen: list[dict]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return answer(request) if callable(answer) else httpx.Response(200, json=answer)

    real = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return real(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(runner_client.httpx, "AsyncClient", client)


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _ok(files: dict[str, bytes], **extra: Any) -> dict:
    return {
        "status": "ok",
        "value": extra.get("value"),
        "stdout": extra.get("stdout", ""),
        "stderr": "",
        "files": [{"path": path, "base64": _b64(data), "size": len(data)} for path, data in files.items()],
        "durationMs": 42,
    }


class TestARun:
    async def test_without_a_runner_nothing_runs(self, store) -> None:
        assert await run.execute("", "export default () => 1") == run.NO_RUNNER

    async def test_without_a_conversation_nothing_runs(self, store, monkeypatch) -> None:
        from nat.plugin_api import Context

        monkeypatch.setattr(Context, "get", staticmethod(lambda: _Context(None)))
        assert await run.execute(RUNNER, "export default () => 1") == run.NO_CONVERSATION

    async def test_the_working_directory_goes_in_under_workspace(self, store, monkeypatch) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        assert (await backend.awrite(f"{DRAFT_ROOT}raeume.md", "# Räume\n")).error is None
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        await run.execute(RUNNER, "export default () => 1", timeout_seconds=999)

        body = seen[0]
        assert body["language"] == "ts"
        assert body["timeoutMs"] == run.MAX_TIMEOUT_S * 1000
        assert [(f["path"], base64.b64decode(f["base64"])) for f in body["files"]] == [
            ("/workspace/raeume.md", "# Räume\n".encode())
        ]

    async def test_a_written_file_is_kept_in_the_working_directory(self, store, monkeypatch, registry) -> None:
        workbook = b"PK\x03\x04 workbook \xff"
        _runner(monkeypatch, _ok({"/workspace/flaechen.xlsx": workbook}, value={"sum": 58.4}), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        item = store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}flaechen.xlsx")
        assert item is not None
        assert item.value["encoding"] == "base64"
        assert base64.b64decode(item.value["content"]) == workbook
        assert '"sum": 58.4' in answer
        assert f"{DRAFT_ROOT}flaechen.xlsx" in answer
        cards = [card for card in registry.snapshot() if card["type"] == "document_draft"]
        assert cards[0]["bytes"] == len(workbook)

    async def test_a_small_text_file_stays_readable_text(self, store, monkeypatch) -> None:
        _runner(monkeypatch, _ok({"/workspace/summe.csv": "Raum;Fläche\nEG;32,4\n".encode()}), [])

        await run.execute(RUNNER, "export default () => 1")

        item = store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}summe.csv")
        assert item.value["encoding"] == "utf-8"
        assert item.value["content"] == "Raum;Fläche\nEG;32,4\n"

    async def test_a_change_to_an_input_document_is_not_kept(self, store, monkeypatch) -> None:
        _runner(monkeypatch, _ok({f"{run.INPUT_DIR}plan.pdf": b"%PDF-changed"}), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert store.search(draft_namespace(CONVERSATION)) == []
        assert "files written: none" in answer

    async def test_an_error_comes_back_for_the_model_to_fix(self, store, monkeypatch) -> None:
        failed = {**_ok({}), "status": "error", "stderr": "TypeError: docx.Tabel is not a constructor"}
        _runner(monkeypatch, failed, [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert answer.startswith("status: error")
        assert "docx.Tabel is not a constructor" in answer

    async def test_an_unreachable_runner_says_nothing_ran(self, store, monkeypatch) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        _runner(monkeypatch, refuse, [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert answer.startswith("Nothing was run")

    async def test_a_busy_runner_is_asked_again(self, store, monkeypatch) -> None:
        monkeypatch.setattr(runner_client, "BUSY_BACKOFF_S", 0)
        answers = iter([httpx.Response(503, json={"error": "busy"}), httpx.Response(200, json=_ok({}))])
        _runner(monkeypatch, lambda request: next(answers), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert answer.startswith("status: ok")

    async def test_files_past_the_conversation_cap_are_not_kept(self, store, monkeypatch) -> None:
        monkeypatch.setattr("agent.tools.documents.draft_store.MAX_RUN_FILE_BYTES", 10)
        _runner(monkeypatch, _ok({"/workspace/big.pdf": b"%PDF-" + b"x" * 64}), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert "not kept" in answer
        assert store.search(draft_namespace(CONVERSATION)) == []


async def test_a_named_document_reports_its_collection(store, monkeypatch) -> None:
    from agent.knowledge import restricted_use
    from agent.tools.look.resolve import Resolved

    async def resolve(name: str) -> Resolved:
        return Resolved(file_name="Raumbuch.pdf", collection="proj_abc_restricted")

    monkeypatch.setattr(run, "resolve_document", resolve)
    monkeypatch.setattr(run, "_headers", lambda: {"x": "y"})
    monkeypatch.setattr(run, "locate_stored_file", lambda collection, name, headers: ("bucket", "key"))
    monkeypatch.setattr(run, "read_stored_file", lambda bucket, key, budget: b"%PDF-1.7")
    seen: list[dict] = []
    _runner(monkeypatch, _ok({}), seen)
    reads: set[str] = set()
    token = restricted_use._call_reads.set(reads)
    try:
        await run.execute(RUNNER, "export default () => 1", documents=["Raumbuch.pdf"])
    finally:
        restricted_use._call_reads.reset(token)

    assert reads == {"proj_abc_restricted"}
    assert [f["path"] for f in seen[0]["files"]] == [f"{run.INPUT_DIR}Raumbuch.pdf"]
