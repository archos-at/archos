from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from typing import Any

import httpx
import pytest
from langgraph.store.memory import InMemoryStore

from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.tools.documents.draft_store import DERIVED_FROM_KEY
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import FILED_DOCUMENT_KEY
from agent.tools.documents.draft_store import FILED_HASH_KEY
from agent.tools.documents.draft_store import FILED_STATE_KEY
from agent.tools.documents.draft_store import FILED_VERSION_KEY
from agent.tools.documents.draft_store import VERSION_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.execute import run
from agent.tools.execute import runner_client
from agent.tools.execute import trace

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
        "deleted": extra.get("deleted", []),
    }


class TestOneRunAtATimePerConversation:
    async def test_runs_of_one_conversation_never_overlap_and_no_lock_is_left(self, store, monkeypatch) -> None:
        running = 0
        most = 0

        async def run_code(*args: Any, **kwargs: Any) -> runner_client.RunResult:
            nonlocal running, most
            running += 1
            most = max(most, running)
            await asyncio.sleep(0.01)
            running -= 1
            return runner_client.RunResult(status="ok")

        monkeypatch.setattr(run, "run_code", run_code)

        await asyncio.gather(*(run.execute(RUNNER, "export default () => 1") for _ in range(6)))

        assert most == 1
        assert run._locks == {}

    async def test_a_held_lock_is_never_dropped_while_many_other_conversations_come_and_go(self) -> None:
        async with run._lock("held"):
            for index in range(1000):
                async with run._lock(f"other-{index}"):
                    pass
            assert list(run._locks) == ["held"]
            waiting = asyncio.ensure_future(_enter(run._lock("held")))
            await asyncio.sleep(0)
            assert not waiting.done()
        await waiting
        assert run._locks == {}


async def _enter(lock: Any) -> None:
    async with lock:
        pass


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

        await run.execute(RUNNER, 'export default () => fs.readFile("/workspace/raeume.md")', timeout_seconds=999)

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

    async def test_a_file_written_under_the_input_directory_is_not_kept_and_the_report_says_so(
        self, store, monkeypatch
    ) -> None:
        _runner(monkeypatch, _ok({f"{run.INPUT_DIR}plan.pdf": b"%PDF-changed"}), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert store.search(draft_namespace(CONVERSATION)) == []
        assert "files written: none" in answer
        assert f"not kept: {run.INPUT_DIR}plan.pdf was dropped" in answer

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


def _documents(monkeypatch: pytest.MonkeyPatch, named: dict[str, tuple[str, str, bytes]]) -> None:
    from agent.tools.look.resolve import Resolved

    async def resolve(name: str) -> Resolved:
        collection, file_name, _ = named[name]
        return Resolved(file_name=file_name, collection=collection)

    by_key = {f"{collection}/{file_name}": data for collection, file_name, data in named.values()}
    monkeypatch.setattr(run, "resolve_document", resolve)
    monkeypatch.setattr(run, "_headers", lambda: {"x": "y"})
    monkeypatch.setattr(run, "locate_stored_file", lambda collection, name, headers: ("bucket", f"{collection}/{name}"))
    monkeypatch.setattr(run, "read_stored_file", lambda bucket, key, budget: by_key[key])


class TestInputPaths:
    async def test_two_documents_of_one_name_both_arrive_and_the_report_names_each_path(
        self, store, monkeypatch
    ) -> None:
        _documents(
            monkeypatch,
            {
                "a": ("proj_a", "Plan.pdf", b"%PDF-a"),
                "b": ("proj_b", "Ordner/Plan.pdf", b"%PDF-b"),
                "c": ("proj_c", "Plan.pdf", b"%PDF-c"),
            },
        )
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a", "b", "c"])

        sent = {f["path"]: base64.b64decode(f["base64"]) for f in seen[0]["files"]}
        assert sent == {
            f"{run.INPUT_DIR}Plan.pdf": b"%PDF-a",
            f"{run.INPUT_DIR}Plan (2).pdf": b"%PDF-b",
            f"{run.INPUT_DIR}Plan (3).pdf": b"%PDF-c",
        }
        assert (
            f"documents read: 'Plan.pdf' at {run.INPUT_DIR}Plan.pdf, 'Ordner/Plan.pdf' at {run.INPUT_DIR}Plan (2).pdf, "
            f"'Plan.pdf' at {run.INPUT_DIR}Plan (3).pdf"
        ) in answer

    async def test_one_document_named_twice_is_sent_once(self, store, monkeypatch) -> None:
        _documents(monkeypatch, {"a": ("proj_a", "Plan.pdf", b"%PDF-a"), "A": ("proj_a", "Plan.pdf", b"%PDF-a")})
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        await run.execute(RUNNER, "export default () => 1", documents=["a", "A"])

        assert [f["path"] for f in seen[0]["files"]] == [f"{run.INPUT_DIR}Plan.pdf"]

    async def test_a_dot_name_becomes_a_path_the_runner_accepts(self, store, monkeypatch) -> None:
        _documents(monkeypatch, {"a": ("proj_a", "..", b"x"), "b": ("proj_a", "Ordner/.", b"y")})
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a", "b"])

        paths = [f["path"] for f in seen[0]["files"]]
        assert paths == [f"{run.INPUT_DIR}{run.UNNAMED_INPUT}", f"{run.INPUT_DIR}{run.UNNAMED_INPUT} (2)"]
        assert f"'..' at {run.INPUT_DIR}{run.UNNAMED_INPUT}" in answer

    async def test_an_input_does_not_overwrite_a_working_file_at_the_same_path(self, store, monkeypatch) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        assert (await backend.awrite(f"{DRAFT_ROOT}in/Plan.md", "# alt\n")).error is None
        _documents(monkeypatch, {"a": ("proj_a", "Plan.md", b"# neu\n")})
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        await run.execute(RUNNER, "export default () => readdir('/workspace')", documents=["a"])

        sent = {f["path"]: base64.b64decode(f["base64"]) for f in seen[0]["files"]}
        assert sent[f"{run.INPUT_DIR}Plan.md"] == b"# alt\n"
        assert sent[f"{run.INPUT_DIR}Plan (2).md"] == b"# neu\n"

    async def test_a_changed_input_is_dropped_and_the_report_says_so(self, store, monkeypatch) -> None:
        _documents(monkeypatch, {"a": ("proj_a", "Plan.pdf", b"%PDF-a")})
        _runner(monkeypatch, _ok({f"{run.INPUT_DIR}Plan.pdf": b"%PDF-changed"}), [])

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a"])

        assert store.search(draft_namespace(CONVERSATION)) == []
        assert f"not kept: {run.INPUT_DIR}Plan.pdf was changed by the script; inputs are read-only" in answer

    async def test_an_input_returned_unchanged_is_not_reported(self, store, monkeypatch) -> None:
        _documents(monkeypatch, {"a": ("proj_a", "Plan.pdf", b"%PDF-a")})
        _runner(monkeypatch, _ok({f"{run.INPUT_DIR}Plan.pdf": b"%PDF-a"}), [])

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a"])

        assert "not kept" not in answer


class TestDeletingAndDeriving:
    async def test_a_working_file_the_run_deletes_is_removed_and_its_card_says_so(
        self, store, monkeypatch, registry
    ) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        assert await backend.awrite_run_file(f"{DRAFT_ROOT}alt.xlsx", b"PK-alt") is None
        _runner(
            monkeypatch,
            _ok({"/workspace/neu.xlsx": b"PK-alt"}, deleted=["/workspace/alt.xlsx"]),
            [],
        )

        answer = await run.execute(RUNNER, 'await rename("/workspace/alt.xlsx", "/workspace/neu.xlsx")')

        assert store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}alt.xlsx") is None
        assert store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}neu.xlsx") is not None
        assert f"removed from the working directory: {DRAFT_ROOT}alt.xlsx" in answer
        removed = [card for card in registry.snapshot() if card.get("removed")]
        assert [card["path"] for card in removed] == [f"{DRAFT_ROOT}alt.xlsx"]

    async def test_a_draft_written_again_while_the_run_ran_is_not_removed(self, store, monkeypatch) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        path = f"{DRAFT_ROOT}bleibt.xlsx"
        assert await backend.awrite_run_file(path, b"PK") is None

        def answer(request: httpx.Request) -> httpx.Response:
            item = store.get(draft_namespace(CONVERSATION), path)
            store.put(draft_namespace(CONVERSATION), path, {**item.value, VERSION_KEY: 2})
            return httpx.Response(200, json=_ok({}, deleted=["/workspace/bleibt.xlsx"]))

        _runner(monkeypatch, answer, [])

        await run.execute(RUNNER, "export default () => 1")

        assert store.get(draft_namespace(CONVERSATION), path) is not None

    async def test_nothing_is_kept_when_the_conversation_was_erased_while_the_run_ran(self, store, monkeypatch) -> None:
        from agent.tools.execute import tool_data

        async def erased(conversation_id: str) -> bool:
            return True

        monkeypatch.setattr(run, "is_erased", erased)
        _runner(monkeypatch, _ok({"/workspace/neu.xlsx": b"PK"}), [])

        answer = await run.execute(RUNNER, "export default () => 1")

        assert answer == run.NO_CONVERSATION
        assert store.search(draft_namespace(CONVERSATION)) == []
        assert tool_data.ERASED_KEY == "erased"

    async def test_a_changed_copy_of_a_project_document_records_where_it_came_from(
        self, store, monkeypatch, registry
    ) -> None:
        async def document(name: str, budget: int) -> tuple[str, str, bytes, str | None]:
            return "proj_p1", "Ordner/Raumbuch.xlsx", b"PK-original", "doc-raumbuch"

        monkeypatch.setattr(run, "_document_bytes", document)
        _runner(monkeypatch, _ok({"/workspace/Raumbuch.xlsx": b"PK-changed"}), [])

        await run.execute(RUNNER, 'writeFile("/workspace/Raumbuch.xlsx", b)', documents=["Raumbuch.xlsx"])

        item = store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}Raumbuch.xlsx")
        assert item.value[DERIVED_FROM_KEY] == {
            "document_id": "doc-raumbuch",
            "name": "Raumbuch.xlsx",
            "content_hash": "sha256:" + hashlib.sha256(b"PK-original").hexdigest(),
        }
        card = next(card for card in registry.snapshot() if card["type"] == "document_draft")
        assert (card["derived_from_document_id"], card["derived_from_name"]) == ("doc-raumbuch", "Raumbuch.xlsx")

    async def test_a_new_file_of_the_same_type_under_another_name_is_not_a_copy_of_the_input(
        self, store, monkeypatch
    ) -> None:
        async def document(name: str, budget: int) -> tuple[str, str, bytes, str | None]:
            return "proj_p1", "Raumbuch.xlsx", b"PK", "doc-raumbuch"

        monkeypatch.setattr(run, "_document_bytes", document)
        _runner(monkeypatch, _ok({"/workspace/Flaechen.xlsx": b"PK2"}), [])

        await run.execute(RUNNER, 'writeFile("/workspace/Flaechen.xlsx", b)', documents=["Raumbuch.xlsx"])

        item = store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}Flaechen.xlsx")
        assert DERIVED_FROM_KEY not in item.value

    async def test_a_new_file_of_another_type_is_not_a_copy_of_the_input(self, store, monkeypatch) -> None:
        async def document(name: str, budget: int) -> tuple[str, str, bytes, str | None]:
            return "proj_p1", "Raumbuch.xlsx", b"PK", "doc-raumbuch"

        monkeypatch.setattr(run, "_document_bytes", document)
        _runner(monkeypatch, _ok({"/workspace/Bericht.pdf": b"%PDF"}), [])

        await run.execute(RUNNER, 'writeFile("/workspace/Bericht.pdf", b)', documents=["Raumbuch.xlsx"])

        item = store.get(draft_namespace(CONVERSATION), f"{DRAFT_ROOT}Bericht.pdf")
        assert DERIVED_FROM_KEY not in item.value


class TestAFiledDraftAPersonChanged:
    async def _filed(self, store: InMemoryStore) -> None:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        path = f"{DRAFT_ROOT}Raumbuch.xlsx"
        assert await backend.awrite_run_file(path, b"PK-1") is None
        await backend.arecord_filing(
            path,
            {
                FILED_DOCUMENT_KEY: "doc-1",
                FILED_VERSION_KEY: "ver-1",
                FILED_HASH_KEY: "sha256:filed",
                FILED_STATE_KEY: "approved",
            },
            draft_version=1,
        )

    def _project(self, monkeypatch: pytest.MonkeyPatch, content_hash: str, seen: list) -> None:
        from agent.common.bff_http import SignedEnvelope
        from agent.tools.execute import project_state

        def post(payload: dict, envelope: Any) -> dict:
            seen.append(payload)
            return {"documentId": "doc-1", "version": {"contentHash": content_hash, "versionNumber": 3}}

        monkeypatch.setattr(project_state, "_envelope", lambda: SignedEnvelope(header="h", signature="s"))
        monkeypatch.setattr(project_state, "post_document_version", post)

    async def test_the_run_says_it_worked_on_the_stale_copy(self, store, monkeypatch) -> None:
        await self._filed(store)
        seen: list = []
        self._project(monkeypatch, "sha256:person", seen)
        _runner(monkeypatch, _ok({}), [])

        answer = await run.execute(RUNNER, 'fs.readFile("/workspace/Raumbuch.xlsx")')

        assert seen == [{"op": "status", "documentId": "doc-1"}]
        assert f"note: {DRAFT_ROOT}Raumbuch.xlsx was changed in the project by a person since it was filed" in answer
        assert "(now Fassung 3)" in answer

    async def test_an_unchanged_filing_says_nothing(self, store, monkeypatch) -> None:
        await self._filed(store)
        self._project(monkeypatch, "sha256:filed", [])
        _runner(monkeypatch, _ok({}), [])

        answer = await run.execute(RUNNER, 'fs.readFile("/workspace/Raumbuch.xlsx")')

        assert "note:" not in answer


class TestLargeInputs:
    async def test_documents_past_the_limit_are_named_as_not_loaded(self, store, monkeypatch) -> None:
        names = [f"d{index}" for index in range(run.MAX_DOCUMENTS + 2)]
        _documents(monkeypatch, {name: ("proj_a", f"{name}.pdf", b"%PDF") for name in names})
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        answer = await run.execute(RUNNER, "export default () => 1", documents=names)

        assert len(seen[0]["files"]) == run.MAX_DOCUMENTS
        assert f"not loaded: 'd{run.MAX_DOCUMENTS}', 'd{run.MAX_DOCUMENTS + 1}'" in answer

    async def test_one_file_past_the_runner_limit_is_refused_by_name_and_size_and_nothing_runs(
        self, store, monkeypatch
    ) -> None:
        from agent.common.stored_file import StoredFileUnavailable
        from agent.tools.execute.workspace_files import MAX_FILE_BYTES

        def too_large(bucket: str, key: str, budget: int) -> bytes:
            raise StoredFileUnavailable("too_large", size=MAX_FILE_BYTES + 1)

        _documents(monkeypatch, {"a": ("proj_a", "Bestand.ifc", b"")})
        monkeypatch.setattr(run, "read_stored_file", too_large)
        seen: list[dict] = []
        _runner(monkeypatch, _ok({}), seen)

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a"])

        assert seen == []
        assert answer.startswith("Nothing was run.")
        assert "'Bestand.ifc' is 32.0 MB" in answer

    async def test_a_file_the_remaining_budget_cannot_take_says_so(self, store, monkeypatch) -> None:
        from agent.common.stored_file import StoredFileUnavailable

        def too_large(bucket: str, key: str, budget: int) -> bytes:
            raise StoredFileUnavailable("too_large", size=budget + 1024 * 1024)

        monkeypatch.setattr(run, "MAX_INPUT_BYTES", 2 * 1024 * 1024)
        _documents(monkeypatch, {"a": ("proj_a", "Plan.pdf", b"")})
        monkeypatch.setattr(run, "read_stored_file", too_large)
        _runner(monkeypatch, _ok({}), [])

        answer = await run.execute(RUNNER, "export default () => 1", documents=["a"])

        assert "'Plan.pdf' is 3.0 MB, but only 2.0 MB" in answer
        assert "Name fewer documents in one run." in answer


@pytest.mark.parametrize(
    ("file_name", "expected"),
    [
        ("Ordner/Plan.pdf", "Plan.pdf"),
        ("Ordner\\Plan.pdf", "Plan.pdf"),
        ("", run.UNNAMED_INPUT),
        (".", run.UNNAMED_INPUT),
        ("..", run.UNNAMED_INPUT),
        ("a/", run.UNNAMED_INPUT),
        ("  ", run.UNNAMED_INPUT),
        ("Pl\x00an\n.pdf", "Plan.pdf"),
        (".htaccess", ".htaccess"),
    ],
)
def test_an_input_name_is_one_safe_segment(file_name: str, expected: str) -> None:
    assert run.input_name(file_name) == expected


def test_a_taken_path_gets_the_next_number_before_the_extension() -> None:
    taken = {f"{run.INPUT_DIR}Plan.tar.gz", f"{run.INPUT_DIR}Plan.tar (2).gz", f"{run.INPUT_DIR}README"}
    assert run.unique_input_path("Plan.tar.gz", taken) == f"{run.INPUT_DIR}Plan.tar (3).gz"
    assert run.unique_input_path("README", taken) == f"{run.INPUT_DIR}README (2)"
    assert run.unique_input_path(".env", {f"{run.INPUT_DIR}.env"}) == f"{run.INPUT_DIR}.env (2)"


class TestTheTrace:
    @pytest.fixture
    def traced(self, monkeypatch: pytest.MonkeyPatch) -> dict[str, list]:
        seen: dict[str, list] = {"spans": [], "scores": []}
        monkeypatch.setattr(
            trace,
            "emit_step_span",
            lambda name, body_in, body_out, **_: seen["spans"].append((name, body_in, body_out)),
        )
        monkeypatch.setattr(
            trace, "emit_scores", lambda scores, **kwargs: seen["scores"].append((list(scores), kwargs["writer"]))
        )
        return seen

    @staticmethod
    def _scores(traced: dict[str, list]) -> dict[tuple[str, str | None], Any]:
        return {(score.name, score.item): score for batch, _ in traced["scores"] for score in batch}

    async def test_a_kept_file_is_measured_without_its_content(self, store, monkeypatch, registry, traced) -> None:
        secret = "export default () => 'Mietvertrag Huber'"
        _runner(monkeypatch, _ok({"/workspace/flaechen.xlsx": b"PK" + b"x" * 98}), [])

        await run.execute(RUNNER, secret)

        name, body_in, body_out = traced["spans"][0]
        assert name == "execute.run"
        assert body_in["code_chars"] == len(secret)
        assert len(body_in["code_sha256"]) == 16
        assert body_in["documents"] is False
        assert body_out["status"] == "ok"
        assert body_out["runner_ms"] == 42
        assert body_out["wall_ms"] >= 0
        assert (body_out["files_kept"], body_out["files_new"], body_out["kept_bytes"]) == (1, 1, 100)
        assert body_out["file_types"] == ["xlsx"]
        assert "Huber" not in json.dumps(traced["spans"])
        scores = self._scores(traced)
        assert scores[("execute-status", "run:1")].value == "ok"
        assert scores[("execute-files-made", "run:1")].value == 1.0
        assert scores[("execute-runs-to-file", "run:1")].value == 1.0
        assert traced["scores"][0][1] == "execute"

    async def test_an_error_carries_the_first_stderr_line_and_the_tries_are_counted(
        self, store, monkeypatch, registry, traced
    ) -> None:
        answers = iter(
            [
                {**_ok({}), "status": "error", "stderr": "\nTypeError: docx.Tabel is not a constructor\n    at run"},
                _ok({"/workspace/a.docx": b"PK1"}),
                _ok({"/workspace/a.docx": b"PK2"}),
            ]
        )
        _runner(monkeypatch, lambda request: httpx.Response(200, json=next(answers)), [])

        for _ in range(3):
            await run.execute(RUNNER, "export default () => 1")

        assert traced["spans"][0][2]["stderr_first_line"] == "TypeError: docx.Tabel is not a constructor"
        assert "stderr_first_line" not in traced["spans"][1][2]
        scores = self._scores(traced)
        assert scores[("execute-status", "run:1")].value == "error"
        assert ("execute-runs-to-file", "run:1") not in scores
        assert scores[("execute-runs-to-file", "run:2")].value == 2.0
        assert scores[("execute-runs-to-file", "run:3")].value == 1.0
        assert scores[("execute-files-made", "run:3")].value == 0.0

    async def test_an_unreachable_runner_is_unavailable(self, store, monkeypatch, registry, traced) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        _runner(monkeypatch, refuse, [])

        await run.execute(RUNNER, "export default () => 1")

        scores = self._scores(traced)
        assert (scores[("execute-status", "run:1")].value, scores[("execute-status", "run:1")].comment) == (
            "unavailable",
            "unreachable",
        )
        assert ("execute-files-made", "run:1") not in scores

    async def test_no_runner_and_a_refused_document_are_recorded(self, store, monkeypatch, registry, traced) -> None:
        async def resolve(name: str) -> str:
            return f"No document called {name}."

        monkeypatch.setattr(run, "resolve_document", resolve)

        await run.execute("", "export default () => 1")
        await run.execute(RUNNER, "export default () => 1", documents=["Raumbuch.pdf"])

        scores = self._scores(traced)
        assert (scores[("execute-status", "run:1")].value, scores[("execute-status", "run:1")].comment) == (
            "unavailable",
            "no_runner",
        )
        assert (scores[("execute-status", "run:2")].value, scores[("execute-status", "run:2")].comment) == (
            "refused",
            "unresolved",
        )
        assert traced["spans"][1][1]["documents"] is True

    async def test_a_kept_file_is_marked_as_made_by_a_run(self, store, monkeypatch) -> None:
        _runner(monkeypatch, _ok({"/workspace/flaechen.xlsx": b"PK"}), [])

        await run.execute(RUNNER, "export default () => 1")

        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        assert (await backend.ausage(f"{DRAFT_ROOT}flaechen.xlsx")).made_by == "execute"


def test_the_file_type_is_the_lowercased_extension() -> None:
    assert [trace.file_type(p) for p in ("/w/a.DOCX", "/w/README", "/w/.env", "/w/x.tar.gz")] == [
        "docx",
        "none",
        "none",
        "gz",
    ]


def test_a_filed_run_file_counts_once_per_path() -> None:
    first, again = trace.filed_scores("/drafts/a.docx"), trace.filed_scores("/drafts/a.docx")
    assert first[0].name == "execute-files-filed"
    assert first[0].item == again[0].item != trace.filed_scores("/drafts/b.docx")[0].item
