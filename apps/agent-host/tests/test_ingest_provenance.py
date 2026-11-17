from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import set_active_ingestor
from agent_host.routes.ingest import add_ingest_routes

_AGENT_FILED = {
    "file_ref": "http://seaweedfs.test/bucket/aktenvermerk-2026-09-01.md?X-Amz-Signature=abc",
    "collection": "proj_test123",
    "document_id": "doc-1",
    "file_name": "piloti/doc-1/aktenvermerk-2026-09-01.md",
    "authored_by": "agent",
    "approved_by": "Maria Huber",
    "approved_at": "2026-09-01T10:00:00.000Z",
    "producer": "agent_document",
}


@pytest.fixture
def mock_ingestor():
    ingestor = MagicMock()
    ingestor.backend_name = "test"
    ingestor.submit_job.return_value = "job_prov_1"
    set_active_ingestor(ingestor)
    yield ingestor
    clear_active_ingestor()


@pytest.fixture
def app(mock_ingestor, monkeypatch):
    monkeypatch.setenv("SEAWEED_PUBLIC_ENDPOINT", "http://seaweedfs.test")
    monkeypatch.setenv("SEAWEED_ENDPOINT", "http://seaweedfs.test")
    app = FastAPI()
    router = APIRouter()
    add_ingest_routes(router)
    app.include_router(router)
    return app


async def _ingest(app, body: dict) -> httpx.Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/v1/ingest", json=body)


def _config(mock_ingestor) -> dict:
    return mock_ingestor.submit_job.call_args.kwargs["config"]


@pytest.mark.asyncio
async def test_the_four_keys_reach_the_ingest_job_config(app, mock_ingestor):
    response = await _ingest(app, _AGENT_FILED)

    assert response.status_code == 202
    config = _config(mock_ingestor)
    assert config["authored_by"] == "agent"
    assert config["approved_by"] == "Maria Huber"
    assert config["approved_at"] == "2026-09-01T10:00:00.000Z"
    assert config["producer"] == "agent_document"


@pytest.mark.asyncio
async def test_the_stated_file_name_is_what_the_chunks_are_filed_under(app, mock_ingestor):
    response = await _ingest(app, _AGENT_FILED)

    assert response.status_code == 202
    assert _config(mock_ingestor)["original_filenames"] == ["piloti/doc-1/aktenvermerk-2026-09-01.md"]


@pytest.mark.asyncio
async def test_without_a_stated_name_the_url_still_decides(app, mock_ingestor):
    response = await _ingest(
        app,
        {
            "file_ref": "http://seaweedfs.test/bucket/Z%C3%BCrich%20Plan.pdf?X-Amz-Signature=abc",
            "collection": "proj_test123",
        },
    )

    assert response.status_code == 202
    assert _config(mock_ingestor)["original_filenames"] == ["Zürich Plan.pdf"]


@pytest.mark.asyncio
async def test_a_human_document_carries_no_provenance_at_all(app, mock_ingestor):
    response = await _ingest(
        app,
        {
            "file_ref": "http://seaweedfs.test/bucket/plan.pdf?X-Amz-Signature=abc",
            "collection": "proj_test123",
        },
    )

    assert response.status_code == 202
    config = _config(mock_ingestor)
    for key in ("authored_by", "approved_by", "approved_at", "producer"):
        assert key not in config


@pytest.mark.asyncio
async def test_a_non_agent_author_carries_nothing_either(app, mock_ingestor):
    response = await _ingest(
        app,
        {
            "file_ref": "http://seaweedfs.test/bucket/plan.pdf?X-Amz-Signature=abc",
            "collection": "proj_test123",
            "authored_by": "user",
            "approved_by": "Maria Huber",
        },
    )

    assert response.status_code == 202
    config = _config(mock_ingestor)
    assert "authored_by" not in config
    assert "approved_by" not in config


@pytest.mark.asyncio
async def test_an_agent_document_with_no_approver_still_states_its_author(app, mock_ingestor):
    response = await _ingest(
        app,
        {
            "file_ref": "http://seaweedfs.test/bucket/plan.md?X-Amz-Signature=abc",
            "collection": "proj_test123",
            "authored_by": "agent",
        },
    )

    assert response.status_code == 202
    config = _config(mock_ingestor)
    assert config["authored_by"] == "agent"
    assert "approved_by" not in config
