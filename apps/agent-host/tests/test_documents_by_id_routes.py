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
from agent_host.routes import document_edits
from agent_host.routes.documents import add_document_routes

COLLECTION = "proj_a"
BESTAND = "aaaaaaaa-0000-4000-8000-00000000000a"
DRAFT = "bbbbbbbb-0000-4000-8000-00000000000b"
BY_ID = f"/v1/collections/{COLLECTION}/documents/by-id"


@pytest.fixture
def store(tmp_path: Path, monkeypatch):
    db_url = f"sqlite:///{tmp_path / 'by-id.db'}"
    DocumentMetadataStore._tables_initialized.discard(db_url)
    configure_summary_db(db_url)
    store = DocumentMetadataStore(db_url)
    store.register(COLLECTION, "Plan.pdf", "Der Bestand.", ["Grundriss"], document_id=BESTAND)
    store.register(COLLECTION, "Plan.pdf", "Der Entwurf.", ["Grundriss"], document_id=DRAFT)
    monkeypatch.setattr(document_edits, "stored_file_name", lambda collection, document_id: "Plan.pdf")
    yield store
    with DocumentMetadataStore._cache_lock:
        for cache in (DocumentMetadataStore._sync_engine_cache, DocumentMetadataStore._async_engine_cache):
            engine = cache.pop(db_url, (None, None))[0]
            if engine is not None:
                disposed = engine.dispose()
                if asyncio.iscoroutine(disposed):
                    asyncio.run(disposed)


@pytest.fixture
def ingestor():
    ingestor = MagicMock()
    ingestor.backend_name = "test"
    ingestor.get_document_visual_details.return_value = [{"page": 2}]
    set_active_ingestor(ingestor)
    yield ingestor
    clear_active_ingestor()


@pytest.fixture
def app(ingestor):
    app = FastAPI()
    router = APIRouter()
    add_document_routes(router)
    app.include_router(router)
    return app


async def _patch(app, path: str, body: dict):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.patch(path, json=body)


def _by_id(store: DocumentMetadataStore) -> dict[str, object]:
    return {doc.document_id: doc for doc in store.get_all(COLLECTION)}


@pytest.mark.parametrize(
    ("suffix", "body", "field", "value"),
    [
        ("tags", {"tags": ["Schnitt"]}, "tags", ["Schnitt"]),
        ("display-title", {"display_title": "Entwurf, Stand März"}, "display_title", "Entwurf, Stand März"),
        ("folder-path", {"folder_path": "Einreichung"}, "folder_path", "Einreichung"),
    ],
)
async def test_an_edit_by_id_touches_only_that_document_of_a_shared_name(app, store, suffix, body, field, value):
    before = getattr(_by_id(store)[BESTAND], field)

    response = await _patch(app, f"{BY_ID}/{DRAFT}/{suffix}", body)

    assert response.status_code == 200
    assert response.json()["document_id"] == DRAFT and response.json()["file_name"] == "Plan.pdf"
    documents = _by_id(store)
    assert getattr(documents[DRAFT], field) == value
    assert getattr(documents[BESTAND], field) == before


async def test_an_unknown_id_is_a_404_naming_the_id(app, store, monkeypatch):
    monkeypatch.setattr(document_edits, "stored_file_name", lambda collection, document_id: "")
    unknown = "cccccccc-0000-4000-8000-00000000000c"

    response = await _patch(app, f"{BY_ID}/{unknown}/tags", {"tags": ["Schnitt"]})

    assert response.status_code == 404 and unknown in response.json()["detail"]


async def test_an_id_that_is_no_document_id_never_reaches_the_name_routes(app, store):
    response = await _patch(app, f"{BY_ID}/Plan.pdf/tags", {"tags": ["Schnitt"]})

    assert response.status_code == 422


async def test_the_file_name_of_one_document_is_rewritten_by_its_id(app, store, monkeypatch):
    renamed: list[tuple[str, str, str, str | None]] = []
    monkeypatch.setattr("agent.knowledge.factory._rename_points", lambda *arguments: renamed.append(arguments) or None)

    response = await _patch(app, f"{BY_ID}/{DRAFT}/file-name", {"file_name": "Plan 2.pdf"})

    assert response.status_code == 200
    assert response.json() == {"collection_name": COLLECTION, "document_id": DRAFT, "file_name": "Plan 2.pdf"}
    documents = _by_id(store)
    assert (documents[DRAFT].file_name, documents[BESTAND].file_name) == ("Plan 2.pdf", "Plan.pdf")
    assert renamed == [(COLLECTION, DRAFT, "Plan 2.pdf", "Plan.pdf")]


async def test_visual_details_by_id_ask_the_index_for_that_document(app, store, ingestor):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"{BY_ID}/{DRAFT}/visual-details")

    assert response.json() == {"details": [{"page": 2}]}
    ingestor.get_document_visual_details.assert_called_once_with(COLLECTION, "", document_id=DRAFT)


async def test_the_name_route_still_edits_a_document_whose_name_is_its_own(app, tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path / 'by-name.db'}"
    DocumentMetadataStore._tables_initialized.discard(db_url)
    configure_summary_db(db_url)
    store = DocumentMetadataStore(db_url)
    store.register(COLLECTION, "Schnitt.pdf", "Ein Schnitt.", ["Schnitt"])

    response = await _patch(app, f"/v1/collections/{COLLECTION}/documents/Schnitt.pdf/tags", {"tags": ["Grundriss"]})

    assert response.status_code == 200 and "document_id" not in response.json()
    (document,) = store.get_all(COLLECTION)
    assert document.tags == ["Grundriss"]


async def test_a_row_written_before_rows_carried_their_id_keeps_its_name(app, store, monkeypatch):
    legacy = "cccccccc-0000-4000-8000-00000000000c"
    store.register(COLLECTION, "Schnitt.pdf", "Ein Schnitt ohne Id.")
    monkeypatch.setattr(document_edits, "stored_file_name", lambda collection, document_id: "Schnitt.pdf")
    monkeypatch.setattr("agent.knowledge.factory._rename_points", lambda *arguments: None)

    response = await _patch(app, f"{BY_ID}/{legacy}/file-name", {"file_name": "Schnitt 2.pdf"})

    assert response.status_code == 200
    names = sorted(doc.file_name for doc in store.get_all(COLLECTION))
    assert names == ["Plan.pdf", "Plan.pdf", "Schnitt.pdf"]
