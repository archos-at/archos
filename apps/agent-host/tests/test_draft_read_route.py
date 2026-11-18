from __future__ import annotations

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langgraph.store.memory import InMemoryStore

from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import FILED_DOCUMENT_KEY
from agent.tools.documents.draft_store import FILED_HASH_KEY
from agent.tools.documents.draft_store import FILED_STATE_KEY
from agent.tools.documents.draft_store import FILED_VERSION_KEY
from agent.tools.documents.draft_store import MAX_DRAFT_BYTES
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace
from agent_host.routes.internal_auth import _DEV_DEFAULT_TOKEN

_TOKEN = "real-internal-secret"
CONVERSATION = "conv-read-1"
OTHER = "conv-read-2"
PATH = f"{DRAFT_ROOT}befund.md"
CONTENT = "# Befund\n\nText.\n"


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    memory = InMemoryStore()

    async def _get_store(dsn: str | None = None) -> InMemoryStore:
        return memory

    monkeypatch.setattr(draft_store, "get_draft_store", _get_store)
    return memory


@pytest.fixture
def client(store) -> TestClient:
    from agent_host.routes.drafts import add_draft_routes

    router = APIRouter()
    add_draft_routes(router)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def prod_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    monkeypatch.setenv("APP_ENV", "production")


async def _write(store: InMemoryStore, conversation_id: str, name: str, content: str = CONTENT) -> DraftBackend:
    backend = DraftBackend(store=store, conversation_id=conversation_id)
    result = await backend.awrite(f"{DRAFT_ROOT}{name}.md", content)
    assert result.error is None
    return backend


def _headers(token: str | None = _TOKEN) -> dict:
    return {} if token is None else {"x-grid-internal-token": token}


def _list(client: TestClient, conversation_id: str = CONVERSATION, token: str | None = _TOKEN):
    return client.get(f"/v1/drafts/{conversation_id}", headers=_headers(token))


def _read(client: TestClient, path: str, conversation_id: str = CONVERSATION, token: str | None = _TOKEN):
    return client.get(f"/v1/drafts/{conversation_id}", params={"path": path}, headers=_headers(token))


def _read_suffix(client: TestClient, path: str, conversation_id: str = CONVERSATION, token: str | None = _TOKEN):
    return client.get(f"/v1/drafts/{conversation_id}/{path.lstrip('/')}", headers=_headers(token))


class TestTheGuard:
    def test_a_missing_token_is_forbidden_on_the_list(self, client, prod_token) -> None:
        assert _list(client, token=None).status_code == 403

    def test_a_missing_token_is_forbidden_on_the_read(self, client, prod_token) -> None:
        assert _read(client, PATH, token=None).status_code == 403

    def test_a_wrong_token_is_forbidden(self, client, prod_token) -> None:
        assert _list(client, token="nope").status_code == 403
        assert _read(client, PATH, token="nope").status_code == 403

    def test_the_dev_default_outside_a_dev_environment_is_disabled(self, client, monkeypatch) -> None:
        monkeypatch.setenv("INTERNAL_API_TOKEN", _DEV_DEFAULT_TOKEN)
        monkeypatch.setenv("APP_ENV", "production")
        assert _list(client).status_code == 503
        assert _read(client, PATH).status_code == 503


class TestTheListing:
    def test_an_empty_namespace_is_a_404(self, client, prod_token) -> None:
        response = _list(client)
        assert response.status_code == 404

    async def test_one_file_lists_with_path_bytes_and_version(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        response = _list(client)

        assert response.status_code == 200
        assert response.json() == {
            "conversation_id": CONVERSATION,
            "drafts": [{"path": PATH, "bytes": len(CONTENT.encode("utf-8")), "version": 1, "encoding": "utf-8"}],
        }

    async def test_the_listing_carries_no_content(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        body = _list(client).json()

        assert "content" not in body
        assert all("content" not in entry for entry in body["drafts"])

    async def test_the_version_moves_with_edits(self, client, prod_token, store) -> None:
        backend = await _write(store, CONVERSATION, "befund")
        assert (await backend.aedit(PATH, "Text.", "Text.\n\nMehr.")).error is None

        (entry,) = _list(client).json()["drafts"]

        assert entry["version"] == 2

    async def test_another_conversations_files_are_not_listed(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")
        await _write(store, OTHER, "protokoll")

        (entry,) = _list(client).json()["drafts"]

        assert entry["path"] == PATH

    async def test_several_files_come_back_sorted(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "protokoll")
        await _write(store, CONVERSATION, "aktenvermerk")
        await _write(store, CONVERSATION, "befund")

        paths = [entry["path"] for entry in _list(client).json()["drafts"]]

        assert paths == sorted(paths)
        assert len(paths) == 3


class TestTheRead:
    async def test_an_existing_file_reads_back_what_was_written(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        response = _read(client, PATH)

        assert response.status_code == 200
        assert response.json() == {"path": PATH, "content": CONTENT, "version": 1}

    async def test_an_unfiled_draft_carries_no_filing(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        assert "filing" not in _read(client, PATH).json()

    async def test_a_filed_draft_echoes_its_filing_record(self, client, prod_token, store) -> None:
        backend = await _write(store, CONVERSATION, "befund")
        filing = {
            FILED_DOCUMENT_KEY: "doc-1",
            FILED_VERSION_KEY: "ver-1",
            FILED_HASH_KEY: "abc123",
            FILED_STATE_KEY: "open",
        }
        await backend.arecord_filing(PATH, filing)

        response = _read(client, PATH)

        assert response.status_code == 200
        assert response.json()["filing"] == filing

    async def test_a_bare_path_gains_its_leading_slash(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        response = _read(client, "drafts/befund.md")

        assert response.status_code == 200
        assert response.json()["path"] == PATH

    async def test_the_suffix_spelling_reads_the_same_file(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        response = _read_suffix(client, PATH)

        assert response.status_code == 200
        assert response.json() == {"path": PATH, "content": CONTENT, "version": 1}

    def test_an_unknown_path_is_a_404(self, client, prod_token) -> None:
        assert _read(client, f"{DRAFT_ROOT}gibt-es-nicht.md").status_code == 404

    async def test_a_path_in_another_conversations_namespace_is_a_404(self, client, prod_token, store) -> None:
        await _write(store, OTHER, "befund")

        assert _read(client, PATH).status_code == 404

    def test_an_unknown_conversation_is_a_404(self, client, prod_token) -> None:
        assert _read(client, PATH, conversation_id="conv-never-wrote").status_code == 404

    def test_a_store_failure_is_a_500(self, client, prod_token, monkeypatch) -> None:
        async def _explode(dsn: str | None = None):
            raise RuntimeError("store is down")

        monkeypatch.setattr(draft_store, "get_draft_store", _explode)
        assert _list(client).status_code == 500
        assert _read(client, PATH).status_code == 500


class TestTheRefusals:
    def test_a_dotdot_conversation_is_refused(self, client, prod_token) -> None:
        assert _list(client, conversation_id="conv..x").status_code == 400

    @pytest.mark.parametrize("path", [f"{DRAFT_ROOT}../secret.md", "/tmp/secret.md", "", "/"])
    def test_a_path_outside_the_working_directory_is_refused(self, client, prod_token, path: str) -> None:
        assert _read(client, path).status_code == 400

    async def test_a_refused_read_writes_nothing(self, client, prod_token, store) -> None:
        assert _read(client, f"{DRAFT_ROOT}../secret.md").status_code == 400
        assert store.search(draft_namespace(CONVERSATION)) == []

    async def test_a_successful_read_changes_nothing(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        first = _read(client, PATH).json()
        second = _read(client, PATH).json()
        listing = _list(client).json()

        assert first == second == {"path": PATH, "content": CONTENT, "version": 1}
        assert listing["drafts"] == [
            {"path": PATH, "bytes": len(CONTENT.encode("utf-8")), "version": 1, "encoding": "utf-8"}
        ]

    async def test_an_oversize_draft_is_a_413_not_a_stream(self, client, prod_token, store) -> None:
        namespace = draft_namespace(CONVERSATION)
        await store.aput(namespace, PATH, {"content": "x" * (MAX_DRAFT_BYTES + 1)})

        assert _read(client, PATH).status_code == 413


class TestAuthRefusedWithoutToken:
    async def test_an_unauthenticated_list_and_read_answer_403(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        assert _list(client, token=None).status_code == 403
        assert _read(client, PATH, token=None).status_code == 403
        assert _read_suffix(client, PATH, token="wrong").status_code == 403


class TestABinaryFile:
    XLSX = b"PK\x03\x04 not really a workbook \xff\x00"

    async def _write_binary(self, store: InMemoryStore) -> str:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        path = f"{DRAFT_ROOT}flaechen.xlsx"
        assert await backend.awrite_run_file(path, self.XLSX) is None
        return path

    async def test_its_preview_carries_size_and_encoding_but_no_content(self, client, prod_token, store) -> None:
        path = await self._write_binary(store)
        response = _read_suffix(client, path)
        assert response.status_code == 200
        assert response.json() == {"path": path, "encoding": "base64", "bytes": len(self.XLSX), "version": 1}

    async def test_its_bytes_come_back_raw(self, client, prod_token, store) -> None:
        path = await self._write_binary(store)
        response = client.get(
            f"/v1/drafts/{CONVERSATION}/{path.lstrip('/')}", params={"raw": "true"}, headers=_headers()
        )
        assert response.status_code == 200
        assert response.content == self.XLSX

    async def test_it_lists_with_its_real_size(self, client, prod_token, store) -> None:
        path = await self._write_binary(store)
        listing = _list(client).json()["drafts"]
        assert listing == [{"path": path, "bytes": len(self.XLSX), "version": 1, "encoding": "base64"}]


class TestOneDraftsLife:
    XLSX_1 = b"PK-version-1"
    XLSX_2 = b"PK-version-2"

    async def _two_versions(self, store: InMemoryStore) -> str:
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        path = f"{DRAFT_ROOT}raumbuch.xlsx"
        assert await backend.awrite_run_file(path, self.XLSX_1) is None
        assert await backend.awrite_run_file(path, self.XLSX_2) is None
        return path

    def _raw(self, client: TestClient, path: str, version: int) -> object:
        return client.get(
            f"/v1/drafts/{CONVERSATION}/{path.lstrip('/')}",
            params={"raw": "true", "version": version},
            headers=_headers(),
        )

    async def test_an_old_card_gets_the_bytes_of_its_own_version(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        assert self._raw(client, path, 1).content == self.XLSX_1
        assert self._raw(client, path, 2).content == self.XLSX_2
        assert _read_suffix(client, path).json()["previous_version"] == 1

    async def test_a_version_no_longer_kept_answers_410(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        assert await backend.awrite_run_file(path, b"PK-3") is None
        assert self._raw(client, path, 1).status_code == 410

    async def test_restoring_the_earlier_version_makes_it_the_next(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        response = client.post(f"/v1/drafts/{CONVERSATION}/restore", params={"path": path}, headers=_headers())
        assert response.status_code == 200
        assert response.json() == {"path": path, "version": 3}
        assert self._raw(client, path, 3).content == self.XLSX_1

    async def test_deleting_one_draft_leaves_the_others(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        await _write(store, CONVERSATION, "befund")
        response = client.delete(f"/v1/drafts/{CONVERSATION}/{path.lstrip('/')}", headers=_headers())
        assert response.status_code == 204
        assert _read_suffix(client, path).status_code == 404
        assert _read_suffix(client, PATH).status_code == 200
        again = client.delete(f"/v1/drafts/{CONVERSATION}/{path.lstrip('/')}", headers=_headers())
        assert again.status_code == 404

    async def test_a_filing_from_the_person_is_recorded_on_the_draft(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        body = {"documentId": "doc-1", "versionId": "ver-1", "contentHash": "abc", "state": "draft", "draftVersion": 2}
        response = client.put(f"/v1/drafts/{CONVERSATION}/filing", params={"path": path}, json=body, headers=_headers())
        assert response.status_code == 200
        read = _read_suffix(client, path).json()
        assert read["filing"][FILED_DOCUMENT_KEY] == "doc-1"
        assert read["filing"][FILED_HASH_KEY] == "abc"
        assert read["filed_at_version"] == 2

    async def test_the_new_routes_need_the_internal_token(self, client, prod_token, store) -> None:
        path = await self._two_versions(store)
        assert client.post(f"/v1/drafts/{CONVERSATION}/restore", params={"path": path}).status_code == 403
        assert client.delete(f"/v1/drafts/{CONVERSATION}/{path.lstrip('/')}").status_code == 403
