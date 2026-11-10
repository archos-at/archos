"""Tests for the document visual-details endpoint.

``GET /v1/collections/{collection}/documents/{file}/visual-details`` returns the
per-page VLM descriptions of a document's visual chunks (drawings/images/charts)
for the file-preview "detailed information" section. Read-only and fail-open:
an unsupported backend or a lookup error yields ``{"details": []}``.
"""

from unittest.mock import MagicMock

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import set_active_ingestor
from agent.project_context import ORGANIZATION_ID_HEADER
from agent_host.routes.documents import add_document_routes
from agent_host.routes.internal_auth import _TOKEN_HEADERS


def _make_app(ingestor):
    ingestor.backend_name = "test"
    set_active_ingestor(ingestor)
    app = FastAPI()
    router = APIRouter()
    add_document_routes(router)
    app.include_router(router)
    return app


def _client(app):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_returns_details_from_backend():
    ingestor = MagicMock()
    ingestor.get_document_visual_details.return_value = [
        {"page": 1, "content_type": "drawing", "drawing_type": "grundriss", "scale": "1:100", "text": "Ein Grundriss."},
    ]
    app = _make_app(ingestor)
    try:
        async with _client(app) as client:
            res = await client.get("/v1/collections/proj_a/documents/plan.pdf/visual-details")
    finally:
        clear_active_ingestor()

    assert res.status_code == 200
    assert res.json()["details"][0]["drawing_type"] == "grundriss"
    ingestor.get_document_visual_details.assert_called_once_with("proj_a", "plan.pdf")


@pytest.mark.asyncio
async def test_fail_open_on_backend_error():
    ingestor = MagicMock()
    ingestor.get_document_visual_details.side_effect = RuntimeError("chroma down")
    app = _make_app(ingestor)
    try:
        async with _client(app) as client:
            res = await client.get("/v1/collections/proj_a/documents/plan.pdf/visual-details")
    finally:
        clear_active_ingestor()

    assert res.status_code == 200
    assert res.json() == {"details": []}


@pytest.mark.asyncio
async def test_reads_as_the_office_the_bff_names(monkeypatch):
    """No office in the test setup: the route reads as the BFF's (ADR-0158), and refuses quietly without one."""
    from knowledge_layer.vector_store import office_read

    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    ingestor = MagicMock()
    ingestor.get_document_visual_details.side_effect = lambda collection, _name: [
        {"office": bool(office_read(collection))}
    ]
    app = _make_app(ingestor)
    headers = {_TOKEN_HEADERS[0]: "test-token", ORGANIZATION_ID_HEADER: "org-1"}
    try:
        async with _client(app) as client:
            named = await client.get("/v1/collections/proj_a/documents/plan.pdf/visual-details", headers=headers)
            unnamed = await client.get("/v1/collections/proj_a/documents/plan.pdf/visual-details")
    finally:
        clear_active_ingestor()

    assert named.json() == {"details": [{"office": True}]}
    assert unnamed.json() == {"details": []}, "a project scope with no office is refused, never read unfiltered"
