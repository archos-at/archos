from __future__ import annotations

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langgraph.store.memory import InMemoryStore

from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace
from agent_host.routes.internal_auth import _DEV_DEFAULT_TOKEN

_TOKEN = "real-internal-secret"
CONVERSATION = "conv-cleanup-1"
OTHER = "conv-cleanup-2"


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


async def _write(store: InMemoryStore, conversation_id: str, name: str) -> None:
    backend = DraftBackend(store=store, conversation_id=conversation_id)
    result = await backend.awrite(f"{DRAFT_ROOT}{name}.md", f"# {name}\n\nText.\n")
    assert result.error is None


def _keys(store: InMemoryStore, conversation_id: str) -> list[str]:
    return [item.key for item in store.search(draft_namespace(conversation_id))]


def _delete(client: TestClient, conversation_id: str = CONVERSATION, token: str | None = _TOKEN):
    headers = {} if token is None else {"x-grid-internal-token": token}
    return client.delete(f"/v1/drafts/{conversation_id}", headers=headers)


class TestTheGuard:
    def test_a_missing_token_is_forbidden(self, client, prod_token) -> None:
        assert _delete(client, token=None).status_code == 403

    def test_a_wrong_token_is_forbidden(self, client, prod_token) -> None:
        assert _delete(client, token="nope").status_code == 403

    def test_the_dev_default_outside_a_dev_environment_is_disabled(self, client, monkeypatch) -> None:
        monkeypatch.setenv("INTERNAL_API_TOKEN", _DEV_DEFAULT_TOKEN)
        monkeypatch.setenv("APP_ENV", "production")
        assert _delete(client).status_code == 503

    async def test_an_unauthenticated_call_deletes_nothing(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")
        assert _delete(client, token=None).status_code == 403
        assert _keys(store, CONVERSATION) != []


class TestTheDeletion:
    async def test_the_conversations_files_are_gone(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")
        await _write(store, CONVERSATION, "aktenvermerk")

        response = _delete(client)

        assert response.status_code == 204
        assert response.content == b""
        assert _keys(store, CONVERSATION) == []

    async def test_another_conversations_working_directory_stands(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")
        await _write(store, OTHER, "befund")

        assert _delete(client).status_code == 204

        assert _keys(store, CONVERSATION) == []
        assert _keys(store, OTHER) == [f"{DRAFT_ROOT}befund.md"]

    def test_a_conversation_that_never_wrote_a_draft_is_a_204(self, client, prod_token) -> None:
        assert _delete(client).status_code == 204

    async def test_deleting_twice_answers_the_same(self, client, prod_token, store) -> None:
        await _write(store, CONVERSATION, "befund")

        assert _delete(client).status_code == 204
        assert _delete(client).status_code == 204
        assert _keys(store, CONVERSATION) == []

    def test_a_store_failure_is_a_500_not_a_silent_204(self, client, prod_token, monkeypatch) -> None:

        async def _explode(conversation_id: str, dsn: str | None = None) -> int:
            raise RuntimeError("store is down")

        monkeypatch.setattr("agent_host.routes.drafts.delete_conversation_drafts", _explode)
        assert _delete(client).status_code == 500
