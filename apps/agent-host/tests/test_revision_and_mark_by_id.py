import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import configure_summary_db
from agent.knowledge.factory import set_active_ingestor
from agent.knowledge.schema import AvailableDocument
from agent_host.routes import document_revisions
from agent_host.routes import knowledge_mark
from agent_host.routes import revision_compare
from agent_host.routes.documents import add_document_routes
from agent_host.routes.internal_auth import _TOKEN_HEADERS
from agent_host.routes.knowledge_mark import add_knowledge_mark_routes
from agent_host.routes.revision_compare import add_revision_compare_routes

COLLECTION = "proj_a"
BESTAND = "aaaaaaaa-0000-4000-8000-00000000000a"
ENTWURF = "bbbbbbbb-0000-4000-8000-00000000000b"
TOKEN = "test-token"


def _client(*registrars) -> AsyncClient:
    app = FastAPI()
    router = APIRouter()
    for register in registrars:
        register(router)
    app.include_router(router)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestARevisionLinkBetweenTwoDocumentsOfOneName:
    @pytest.fixture
    def store(self, tmp_path: Path, monkeypatch):
        db_url = f"sqlite:///{tmp_path / 'revision.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)
        store = DocumentMetadataStore(db_url)
        store.register(COLLECTION, "Plan.pdf", "Der Bestand.", document_id=BESTAND)
        store.register(COLLECTION, "Plan.pdf", "Der Entwurf.", document_id=ENTWURF)

        async def no_summary(older, newer, organization_id):
            return None

        monkeypatch.setattr(document_revisions, "_request_change_summary", no_summary)
        ingestor = MagicMock()
        ingestor.backend_name = "test"
        set_active_ingestor(ingestor)
        yield store
        clear_active_ingestor()
        with DocumentMetadataStore._cache_lock:
            for cache in (DocumentMetadataStore._sync_engine_cache, DocumentMetadataStore._async_engine_cache):
                engine = cache.pop(db_url, (None, None))[0]
                if engine is not None:
                    disposed = engine.dispose()
                    if asyncio.iscoroutine(disposed):
                        asyncio.run(disposed)

    async def _put(self, body: dict):
        async with _client(add_document_routes) as client:
            return await client.put(f"/v1/collections/{COLLECTION}/revision", json=body)

    async def test_the_ids_link_the_newer_document_to_the_older_one(self, store):
        response = await self._put({"older_id": BESTAND, "newer_id": ENTWURF, "linked": True})

        assert response.status_code == 200
        assert (response.json()["superseded_by"], response.json()["superseded_by_id"]) == ("Plan.pdf", ENTWURF)
        documents = {doc.document_id: doc for doc in store.get_all(COLLECTION)}
        assert documents[BESTAND].superseded_by_id == ENTWURF
        assert documents[ENTWURF].superseded_by_id is None

    async def test_the_shared_name_alone_cannot_say_which_document_is_meant(self, store):
        response = await self._put({"older": "Plan.pdf", "newer": "Plan.pdf", "linked": True})

        assert response.status_code == 409 and response.json()["detail"]["reason"] == "ambiguous_name"

    async def test_a_document_cannot_replace_itself_by_id(self, store):
        response = await self._put({"older_id": ENTWURF, "newer_id": ENTWURF, "linked": True})

        assert response.status_code == 400

    async def test_a_side_named_by_nothing_is_refused(self, store):
        response = await self._put({"older_id": BESTAND, "linked": True})

        assert response.status_code == 422


class TestTheChangedPagesOfTwoDocumentsOfOneName:
    async def test_each_side_is_read_from_the_index_by_its_id(self, monkeypatch):
        async def available(collection):
            return [
                AvailableDocument(file_name="Plan.pdf", document_id=BESTAND),
                AvailableDocument(file_name="Plan.pdf", document_id=ENTWURF),
            ]

        chunks = {
            BESTAND: [("Schnitt\nREI 90", {"page_label": "1"})],
            ENTWURF: [("Schnitt\nREI 60", {"page_label": "1"})],
        }
        read: list[str | None] = []

        def read_chunks(collection, name, document_id=None):
            read.append(document_id)
            return chunks[document_id]

        monkeypatch.setattr(revision_compare, "get_available_documents_async", available)
        monkeypatch.setattr("agent.knowledge.collection_pages.read_chunks", read_chunks)
        async with _client(add_revision_compare_routes) as client:
            response = await client.post(
                f"/v1/collections/{COLLECTION}/revision-pages", json={"older_id": BESTAND, "newer_id": ENTWURF}
            )

        assert response.status_code == 200 and response.json()["pages"] == [1]
        assert sorted(read) == [BESTAND, ENTWURF]


class _Store:
    def __init__(self, documents: tuple[str, ...]) -> None:
        self.documents = documents
        self.counted: list[dict] = []
        self.written: list[tuple[dict, str]] = []

    def exists(self, scope: str) -> bool:
        return True

    def count(self, scope: str, filters: dict) -> int:
        self.counted.append(filters)
        return 2

    def facet_counts(self, scope: str, key: str, filters: dict) -> dict[str, int]:
        return {document_id: 2 for document_id in self.documents}

    def set_file_payloads(self, scope: str, payloads: dict, *, key: str = "file_name") -> None:
        self.written.append((payloads, key))


class TestAKnowledgeMark:
    async def _put(self, store: _Store, body: dict, monkeypatch):
        monkeypatch.setattr(knowledge_mark, "_store", lambda: store)
        monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
        async with _client(add_knowledge_mark_routes) as client:
            return await client.put(
                "/v1/collections/office_shelf_org_1/knowledge-mark", json=body, headers={_TOKEN_HEADERS[0]: TOKEN}
            )

    async def test_by_id_lands_on_that_documents_chunks_only(self, monkeypatch):
        store = _Store((BESTAND, ENTWURF))

        response = await self._put(
            store, {"file_name": "Norm.pdf", "document_id": ENTWURF, "licence_class": "licensed"}, monkeypatch
        )

        assert response.status_code == 200
        assert store.counted == [{"document_id": ENTWURF}]
        assert [(list(payloads), key) for payloads, key in store.written] == [([ENTWURF], "document_id")]

    async def test_a_name_held_by_one_document_is_marked_by_that_documents_id(self, monkeypatch):
        store = _Store((ENTWURF,))

        response = await self._put(store, {"file_name": "Norm.pdf", "licence_class": "licensed"}, monkeypatch)

        assert response.status_code == 200
        assert [(list(payloads), key) for payloads, key in store.written] == [([ENTWURF], "document_id")]

    async def test_a_name_two_documents_hold_is_a_conflict_and_marks_nothing(self, monkeypatch):
        store = _Store((BESTAND, ENTWURF))

        response = await self._put(store, {"file_name": "Norm.pdf", "licence_class": "licensed"}, monkeypatch)

        assert response.status_code == 409 and response.json()["detail"]["reason"] == "ambiguous_name"
        assert store.written == []
