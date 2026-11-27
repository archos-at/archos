from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent.knowledge import factory as knowledge_factory
from agent_host.routes.maintenance import add_tenant_scope_routes

PATH = "/v1/maintenance/tenant-scopes"


class _Ingestor:
    def __init__(self, chunk_counts: dict[str, int] | Exception):
        self.chunk_counts = chunk_counts

    def list_collections(self):
        if isinstance(self.chunk_counts, Exception):
            raise self.chunk_counts
        return [SimpleNamespace(name=name, chunk_count=count) for name, count in self.chunk_counts.items()]


def _app() -> FastAPI:
    app = FastAPI()
    router = APIRouter()
    add_tenant_scope_routes(router)
    app.include_router(router)
    return app


@pytest.fixture
def signed(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "s3cr3t")
    monkeypatch.setenv("APP_ENV", "production")
    return {"x-internal-token": "s3cr3t"}


async def _get(headers: dict[str, str] | None = None):
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        return await client.get(PATH, headers=headers or {})


@pytest.mark.asyncio
async def test_lists_only_the_office_scopes_that_hold_chunks_never_the_base_corpus(signed, monkeypatch):
    ingestor = _Ingestor({"proj_b": 4, "s_conv": 2, "archiv_org": 1, "proj_leer": 0, "base_corpus": 900, "oib": 12})
    monkeypatch.setattr(knowledge_factory, "get_active_ingestor", lambda: ingestor)

    answer = await _get(signed)

    assert answer.status_code == 200
    assert answer.json() == {"status": "ok", "scopes": ["archiv_org", "proj_b", "s_conv"]}


@pytest.mark.asyncio
async def test_refuses_without_the_internal_token_and_when_the_store_cannot_be_listed(signed, monkeypatch):
    ingestor = _Ingestor(RuntimeError("qdrant down"))
    monkeypatch.setattr(knowledge_factory, "get_active_ingestor", lambda: ingestor)

    assert (await _get()).status_code == 403
    assert (await _get(signed)).status_code == 503
