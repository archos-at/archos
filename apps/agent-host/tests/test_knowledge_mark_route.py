"""The licence mark: ``PUT /v1/collections/{c}/knowledge-mark``, and the ingest job that carries it.

The store is stood in for here, so the route's refusals and its call are
checked without a Qdrant; the write itself runs on a real one in
``packages/knowledge-layer/tests/test_vector_store_office_filter.py``.
"""

from __future__ import annotations

import typing
from unittest.mock import MagicMock

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import set_active_ingestor
from agent_host.models.knowledge_mark import LicenceClass
from agent_host.routes import knowledge_mark
from agent_host.routes.ingest import add_ingest_routes
from agent_host.routes.internal_auth import _TOKEN_HEADERS
from agent_host.routes.knowledge_mark import add_knowledge_mark_routes

TOKEN = "knowledge-mark-test-token"
PATH = "/v1/collections/office_shelf_org_1/knowledge-mark"
BODY = {
    "file_name": "OIB-RL_2.pdf",
    "licence_class": "licensed",
    "ai_processing_attested": True,
    "quote_max_chars": 400,
    "edition_id": "ed-2026",
}


class _Store:
    """The store's three calls the route makes, recorded."""

    def __init__(self, chunks: int = 3, exists: bool = True) -> None:
        self.chunks, self.present = chunks, exists
        self.written: list[tuple[str, dict]] = []
        self.counted: list[tuple[str, dict]] = []

    def exists(self, scope: str) -> bool:
        return self.present

    def count(self, scope: str, filters: dict) -> int:
        self.counted.append((scope, filters))
        return self.chunks

    def set_file_payloads(self, scope: str, payloads: dict) -> None:
        self.written.append((scope, payloads))


@pytest.fixture
def store(monkeypatch):
    fake = _Store()
    monkeypatch.setattr(knowledge_mark, "_store", lambda: fake)
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    return fake


def _app() -> FastAPI:
    app = FastAPI()
    router = APIRouter()
    add_knowledge_mark_routes(router)
    app.include_router(router)
    return app


async def _put(body: dict, token: str | None = TOKEN, path: str = PATH):
    headers = {_TOKEN_HEADERS[0]: token} if token is not None else {}
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        return await client.put(path, json=body, headers=headers)


async def test_the_mark_lands_on_every_chunk_of_the_file(store):
    response = await _put(BODY)

    assert response.status_code == 200
    assert response.json() == {
        "collection": "office_shelf_org_1",
        "file_name": "OIB-RL_2.pdf",
        "licence_class": "licensed",
        "edition_id": "ed-2026",
        "chunks": 3,
    }
    assert store.counted == [("office_shelf_org_1", {"file_name": "OIB-RL_2.pdf"})]
    assert store.written == [
        (
            "office_shelf_org_1",
            {
                "OIB-RL_2.pdf": {
                    "licence_class": "licensed",
                    "ai_processing_attested": True,
                    "quote_max_chars": 400,
                    "knowledge_edition_id": "ed-2026",
                }
            },
        )
    ]


async def test_a_base_corpus_text_is_marked_with_its_country(store):
    response = await _put({"file_name": "OIB-RL_2.pdf", "edition_id": None, "country_id": "ZZ"})

    assert response.status_code == 200
    assert store.written[0][1]["OIB-RL_2.pdf"]["country_id"] == "ZZ"


async def test_a_malformed_country_is_refused(store):
    response = await _put({"file_name": "OIB-RL_2.pdf", "country_id": "Austria"})

    assert response.status_code == 422
    assert store.written == []


async def test_null_clears_the_mark(store):
    response = await _put({"file_name": "OIB-RL_2.pdf", "licence_class": None, "edition_id": None})

    assert response.status_code == 200
    fields = ("licence_class", "ai_processing_attested", "quote_max_chars", "knowledge_edition_id")
    cleared = dict.fromkeys(fields)
    assert store.written[0][1] == {"OIB-RL_2.pdf": cleared}


async def test_an_unknown_licence_class_is_refused(store):
    response = await _put({**BODY, "licence_class": "free_for_all"})

    assert response.status_code == 422
    assert store.written == []


@pytest.mark.parametrize("token", [None, "wrong"])
async def test_without_the_internal_token_nothing_is_marked(store, token):
    response = await _put(BODY, token=token)

    assert response.status_code == 403
    assert store.written == []


async def test_a_file_the_collection_does_not_hold_is_a_404(store):
    store.chunks = 0

    response = await _put(BODY)

    assert response.status_code == 404
    assert store.written == []


async def test_a_collection_never_written_is_a_404(store):
    store.present = False

    assert (await _put(BODY)).status_code == 404


async def test_a_store_that_refuses_is_a_502(store, monkeypatch):
    def refuse(*_args, **_kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(store, "set_file_payloads", refuse)

    assert (await _put(BODY)).status_code == 502


def test_the_wire_classes_are_the_stores():
    from knowledge_layer.vector_store import LICENCE_CLASSES

    assert typing.get_args(LicenceClass) == LICENCE_CLASSES


# ---------------------------------------------------------------- the ingest job carries the mark


@pytest.fixture
def ingest_app(monkeypatch):
    ingestor = MagicMock()
    ingestor.backend_name = "test"
    ingestor.submit_job.return_value = "job_mark_1"
    set_active_ingestor(ingestor)
    monkeypatch.setenv("SEAWEED_PUBLIC_ENDPOINT", "http://seaweedfs.test")
    monkeypatch.setenv("SEAWEED_ENDPOINT", "http://seaweedfs.test")
    app = FastAPI()
    router = APIRouter()
    add_ingest_routes(router)
    app.include_router(router)
    yield app, ingestor
    clear_active_ingestor()


async def _ingest(app: FastAPI, **fields) -> int:
    body = {"file_ref": "http://seaweedfs.test/bucket/rl2.pdf?X-Amz-Signature=abc", "collection": "office_shelf_org_1"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return (await client.post("/v1/ingest", json={**body, **fields})).status_code


async def test_the_ingest_job_carries_the_mark_into_its_config(ingest_app):
    app, ingestor = ingest_app

    mark = {"ai_processing_attested": True, "quote_max_chars": 500}
    assert await _ingest(app, licence_class="licensed", knowledge_edition_id="ed-2026", **mark) == 202

    config = ingestor.submit_job.call_args.kwargs["config"]
    assert config["licence_class"] == "licensed"
    assert config["knowledge_edition_id"] == "ed-2026"
    assert config["ai_processing_attested"] is True and config["quote_max_chars"] == 500


async def test_an_ingest_job_with_no_mark_carries_none(ingest_app):
    app, ingestor = ingest_app

    assert await _ingest(app) == 202

    config = ingestor.submit_job.call_args.kwargs["config"]
    assert "licence_class" not in config and "knowledge_edition_id" not in config


async def test_an_ingest_job_with_an_unknown_class_is_refused(ingest_app):
    app, _ingestor = ingest_app

    assert await _ingest(app, licence_class="free_for_all") == 422
