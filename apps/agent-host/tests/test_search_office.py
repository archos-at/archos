"""The office a search route reads as (``document_search.request_office``).

A plain FastAPI route never sees the agent runtime's context headers, so the
searches here name their office themselves: the signed envelope's
organization, or in anonymous mode the organization header (``ORGANIZATION_ID_HEADER``). The
knowledge layer refuses a project read with no office (``vector_store.scope.ScopeRead``).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi import Request
from httpx import ASGITransport
from httpx import AsyncClient
from knowledge_layer.search import office_for

from agent import project_context
from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import clear_active_retriever
from agent.knowledge.factory import set_active_ingestor
from agent.knowledge.factory import set_active_retriever
from agent.knowledge.schema import RetrievalResult
from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent_host.routes.document_search import add_document_search_routes
from agent_host.routes.document_search import request_office

SECRET = "office-secret"


def _envelope(payload: dict, secret: str | None = SECRET) -> dict[str, str]:
    raw = json.dumps(payload)
    headers = {REQUEST_CONTEXT_ENVELOPE_HEADER: base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")}
    if secret:
        headers[REQUEST_CONTEXT_ENVELOPE_SIG_HEADER] = hmac.new(
            secret.encode(), raw.encode(), hashlib.sha256
        ).hexdigest()
    return headers


def _request(headers: dict[str, str]) -> Request:
    raw = [(name.encode(), value.encode()) for name, value in headers.items()]
    return Request({"type": "http", "headers": raw})


class TestRequestOffice:
    def test_the_signed_envelope_names_it(self, monkeypatch):
        monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
        monkeypatch.setenv("REQUIRE_AUTH", "true")

        assert (
            request_office(_request(_envelope({"collectionScope": ["proj_a"], "organizationId": "org_a"}))) == "org_a"
        )

    def test_under_auth_a_raw_header_is_not_believed(self, monkeypatch):
        monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
        monkeypatch.setenv("REQUIRE_AUTH", "true")
        headers = {**_envelope({"collectionScope": ["proj_a"]}), ORGANIZATION_ID_HEADER: "org_forged"}

        assert request_office(_request(headers)) is None

    def test_in_anonymous_mode_the_header_names_it(self, monkeypatch):
        monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
        monkeypatch.delenv("REQUIRE_AUTH", raising=False)

        assert request_office(_request({ORGANIZATION_ID_HEADER: " org_dev "})) == "org_dev"
        assert request_office(_request({})) is None


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setattr(project_context, "get_organization_id_from_context", lambda: None)
    ingestor = MagicMock()
    ingestor.backend_name = "test"
    ingestor.get_collection.return_value = MagicMock()
    set_active_ingestor(ingestor)
    app = FastAPI()
    router = APIRouter()
    add_document_search_routes(router)
    app.include_router(router)
    app.state.ingestor = ingestor
    yield app
    clear_active_ingestor()
    clear_active_retriever()


def _retriever(seen: list[str | None]) -> MagicMock:
    """A retriever that records the office the knowledge layer would read as at the moment it is asked."""

    async def search_grouped(query, collections, **_kwargs):
        seen.append(office_for(collections))
        return []

    async def retrieve(query, collection_name, top_k, filters):
        seen.append(office_for([collection_name]))
        return RetrievalResult(chunks=[], query=query, backend="test", success=True)

    retriever = MagicMock()
    retriever.backend_name = "test"
    retriever.search_grouped = AsyncMock(side_effect=search_grouped)
    retriever.retrieve = AsyncMock(side_effect=retrieve)
    return retriever


async def test_the_grouped_and_the_single_search_read_as_the_signed_office(app):
    seen: list[str | None] = []
    set_active_retriever(_retriever(seen))
    headers = _envelope({"collectionScope": ["proj_a", "proj_b"], "organizationId": "org_a"})

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        grouped = await client.post(
            "/v1/collections/search", json={"query": "Fluchtweg", "collections": ["proj_a", "proj_b"]}, headers=headers
        )
        single = await client.post("/v1/collections/proj_a/search", json={"query": "Fluchtweg"}, headers=headers)

    assert grouped.status_code == 200 and single.status_code == 200
    assert seen == ["org_a", "org_a"]
    # Outside the request the office is gone again.
    assert office_for(["proj_a"]) is None
