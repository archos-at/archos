from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient

from agent.auth import Principal
from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent_host.registry import AgentConfig
from agent_host.routes import job_data_sources
from agent_host.routes import job_handlers


@pytest.fixture(autouse=True)
def data_source_registry():
    reset_registry()
    populate_from_config(
        [
            {
                "id": "web_search",
                "name": "Web Search",
                "description": "Search the web.",
                "tools": ["web_search_tool"],
            },
            {
                "id": "knowledge_layer",
                "name": "Knowledge Base",
                "description": "Search uploaded documents.",
                "tools": ["knowledge_search_tool"],
            },
        ]
    )
    yield
    reset_registry()


@pytest.fixture
async def submit_app(monkeypatch, tmp_path):
    import agent.auth
    import agent_host.routes.jobs as jobs_routes

    submitted_job = AsyncMock(return_value="job-1")
    agent_config = AgentConfig(
        load=lambda: type("Agent", (), {}),
        config_name="deep_research_agent",
        description="Test deep researcher",
    )
    monkeypatch.setattr(job_handlers, "get_agent_config", lambda _agent_type: agent_config)

    monkeypatch.setattr(agent.auth, "get_auth_token", lambda: "token-1")

    from agent_host.jobs import access
    from agent_host.jobs import event_store
    from agent_host.jobs import submit

    monkeypatch.setattr(access, "ensure_job_access_table", MagicMock())
    monkeypatch.setattr(
        job_handlers,
        "require_verified_principal",
        lambda: Principal(type="jwt", sub="user-1", email="user@example.com"),
    )
    monkeypatch.setattr(event_store.EventStore, "_ensure_table_exists", MagicMock())
    monkeypatch.setattr(submit, "submit_agent_job", submitted_job)

    worker = SimpleNamespace(
        _db_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        _config_file_path="config.yml",
        _log_level=20,
        _front_end_config=SimpleNamespace(expiry_seconds=86400),
    )

    web_tool = SimpleNamespace(name="web_search_tool")
    knowledge_tool = SimpleNamespace(name="knowledge_search_tool")
    tools_by_name: dict[str, SimpleNamespace] = {
        "web_search_tool": web_tool,
        "knowledge_search_tool": knowledge_tool,
    }

    async def _filtered_get_tools(*, tool_names, wrapper_type):  # noqa: ARG001 - mirror real signature
        return [tools_by_name[name] for name in tool_names if name in tools_by_name]

    builder = MagicMock()
    builder.get_function_config.return_value = SimpleNamespace(tools=None, exclude_tools=[])
    builder.get_tools = AsyncMock(side_effect=_filtered_get_tools)

    app = FastAPI()
    await jobs_routes.register_job_routes(app, builder, worker)
    return app, submitted_job, builder


@pytest.mark.asyncio
async def test_submit_job_forwards_selected_data_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-1"
    submitted_job.assert_awaited_once()
    assert submitted_job.await_args.kwargs["data_sources"] == ["web_search"]


@pytest.mark.asyncio
async def test_data_sources_lists_registry_and_reports_vlm_available_true(submit_app, monkeypatch):
    app, _submitted_job, _builder = submit_app
    monkeypatch.setenv("VLM_API_KEY", "vlm-secret")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with TestClient(app) as client:
        response = client.get("/v1/data_sources")

    assert response.status_code == 200
    body = response.json()
    assert {source["id"] for source in body["data_sources"]} == {"web_search", "knowledge_layer"}
    assert body["vlm_available"] is True


@pytest.mark.asyncio
async def test_data_sources_reports_vlm_available_false_without_a_key(submit_app, monkeypatch):
    app, _submitted_job, _builder = submit_app
    monkeypatch.delenv("VLM_API_KEY", raising=False)
    monkeypatch.delenv("VLM_BASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with TestClient(app) as client:
        response = client.get("/v1/data_sources")

    assert response.status_code == 200
    assert response.json()["vlm_available"] is False


@pytest.mark.asyncio
async def test_data_sources_vlm_available_true_via_provider_inference(submit_app, monkeypatch):
    app, _submitted_job, _builder = submit_app
    monkeypatch.delenv("VLM_API_KEY", raising=False)
    monkeypatch.delenv("VLM_BASE_URL", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-secret")

    with TestClient(app) as client:
        response = client.get("/v1/data_sources")

    assert response.status_code == 200
    assert response.json()["vlm_available"] is True


@pytest.mark.asyncio
async def test_submit_job_omitted_data_sources_keeps_all_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query"},
        )

    assert response.status_code == 200
    assert submitted_job.await_args.kwargs["data_sources"] is None


@pytest.mark.asyncio
async def test_submit_job_explicit_null_data_sources_keeps_all_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": None},
        )

    assert response.status_code == 200
    assert submitted_job.await_args.kwargs["data_sources"] is None


@pytest.mark.asyncio
async def test_submit_job_forwards_empty_data_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": []},
        )

    assert response.status_code == 200
    assert submitted_job.await_args.kwargs["data_sources"] == []


@pytest.mark.asyncio
async def test_submit_job_rejects_unknown_data_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["does_not_exist", "also_missing"],
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Unknown data source(s): does_not_exist, also_missing",
        "invalid_ids": ["does_not_exist", "also_missing"],
        "unavailable_for_agent": [],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_rejects_source_unavailable_for_agent(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(
        tools=None,
        exclude_tools=["web_search_tool"],
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Data source(s) are not available for agent 'deep_researcher': web_search",
        "invalid_ids": [],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_rejects_mixed_available_and_agent_unavailable_sources(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(tools=None, exclude_tools=["web_search_tool"])

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["web_search", "knowledge_layer"],
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Data source(s) are not available for agent 'deep_researcher': web_search",
        "invalid_ids": [],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_rejects_combined_unknown_and_agent_unavailable_sources(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(tools=None, exclude_tools=["web_search_tool"])

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["does_not_exist", "web_search"],
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": (
            "Unknown data source(s): does_not_exist. "
            "Data source(s) are not available for agent 'deep_researcher': web_search"
        ),
        "invalid_ids": ["does_not_exist"],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_dedupes_problematic_ids_preserving_first_seen_order_and_casing(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(tools=None, exclude_tools=["web_search_tool"])

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["Missing", "web_search", "missing", "WEB_SEARCH"],
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": (
            "Unknown data source(s): Missing. Data source(s) are not available for agent 'deep_researcher': web_search"
        ),
        "invalid_ids": ["Missing"],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_rejects_known_source_when_agent_has_no_available_sources(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(
        tools=None,
        exclude_tools=["web_search_tool", "knowledge_search_tool"],
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Data source(s) are not available for agent 'deep_researcher': web_search",
        "invalid_ids": [],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_forwards_omitted_data_sources_without_resolving_tools(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query"},
        )

    assert response.status_code == 200
    builder.get_function_config.assert_not_called()
    builder.get_tools.assert_not_awaited()
    submitted_job.assert_awaited_once()
    _, kwargs = submitted_job.await_args
    assert kwargs["data_sources"] is None


@pytest.mark.asyncio
async def test_submit_job_forwards_null_data_sources_without_resolving_tools(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": None},
        )

    assert response.status_code == 200
    builder.get_function_config.assert_not_called()
    builder.get_tools.assert_not_awaited()
    submitted_job.assert_awaited_once()
    _, kwargs = submitted_job.await_args
    assert kwargs["data_sources"] is None


@pytest.mark.asyncio
async def test_submit_job_forwards_valid_data_sources_exactly_as_provided(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["WEB_SEARCH", "web_search", "knowledge_layer"],
            },
        )

    assert response.status_code == 200
    submitted_job.assert_awaited_once()
    _, kwargs = submitted_job.await_args
    assert kwargs["data_sources"] == ["WEB_SEARCH", "web_search", "knowledge_layer"]


@pytest.mark.asyncio
async def test_submit_job_validates_sources_for_researcher(submit_app, monkeypatch):
    app, submitted_job, builder = submit_app

    research_config = AgentConfig(
        load=lambda: type("Agent", (), {}),
        config_name="shallow_research_agent",
        description="Test researcher",
    )
    monkeypatch.setattr(job_handlers, "get_agent_config", lambda _agent_type: research_config)
    builder.get_function_config.return_value = SimpleNamespace(
        tools=None,
        exclude_tools=["web_search_tool"],
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Data source(s) are not available for agent 'researcher': web_search",
        "invalid_ids": [],
        "unavailable_for_agent": ["web_search"],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()
    builder.get_function_config.assert_called_with("shallow_research_agent")


@pytest.mark.asyncio
async def test_submit_job_forwards_multiple_data_sources(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["web_search", "knowledge_layer"],
            },
        )

    assert response.status_code == 200
    assert submitted_job.await_args.kwargs["data_sources"] == ["web_search", "knowledge_layer"]


@pytest.mark.asyncio
async def test_submit_job_mixed_valid_and_unknown_rejects_naming_only_unknown(submit_app):
    app, submitted_job, builder = submit_app

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={
                "agent_type": "deep_researcher",
                "input": "query",
                "data_sources": ["web_search", "does_not_exist"],
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "message": "Unknown data source(s): does_not_exist",
        "invalid_ids": ["does_not_exist"],
        "unavailable_for_agent": [],
        "known_ids": ["knowledge_layer", "web_search"],
    }
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_auth_runs_before_data_source_validation(submit_app, monkeypatch):
    app, submitted_job, builder = submit_app

    def _deny():
        raise HTTPException(status_code=403, detail="auth required")

    monkeypatch.setattr(job_handlers, "require_verified_principal", _deny)

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["does_not_exist"]},
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "auth required"
    builder.get_tools.assert_not_awaited()
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_agent_type_validation_runs_before_auth(submit_app, monkeypatch):
    app, submitted_job, builder = submit_app

    def _deny():
        raise HTTPException(status_code=403, detail="auth required")

    monkeypatch.setattr(job_handlers, "require_verified_principal", _deny)
    monkeypatch.setattr(
        job_handlers,
        "get_agent_config",
        lambda _agent_type: (_ for _ in ()).throw(KeyError("unknown agent")),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "nonexistent_agent", "input": "query"},
        )

    assert response.status_code == 400
    builder.get_tools.assert_not_awaited()
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_returns_500_when_validation_tool_resolution_fails_for_known_source(submit_app, caplog):
    app, submitted_job, builder = submit_app
    builder.get_tools.side_effect = RuntimeError("tool resolution failed")
    caplog.set_level(logging.ERROR, logger="agent_host.routes.jobs")

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to validate data sources for selected agent"
    assert "Failed to validate data sources for agent deep_researcher using config deep_research_agent" in caplog.text
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_job_returns_500_when_validation_tool_resolution_fails_for_unknown_source(submit_app):
    app, submitted_job, builder = submit_app
    builder.get_tools.side_effect = RuntimeError("tool resolution failed")

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["does_not_exist"]},
        )

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to validate data sources for selected agent"
    submitted_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_validation_calls_get_all_tool_refs_when_fn_config_tools_is_none(submit_app, monkeypatch):
    app, submitted_job, builder = submit_app

    spy = MagicMock(wraps=job_data_sources.get_all_tool_refs)
    monkeypatch.setattr(job_data_sources, "get_all_tool_refs", spy)

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["web_search"]},
        )

    assert response.status_code == 200
    spy.assert_called_once()
    builder.get_tools.assert_awaited_once()
    _, kwargs = builder.get_tools.await_args
    assert sorted(kwargs["tool_names"]) == ["knowledge_search_tool", "web_search_tool"]
    submitted_job.assert_awaited_once()


@pytest.mark.asyncio
async def test_validation_does_not_call_get_all_tool_refs_when_fn_config_tools_is_explicit(submit_app, monkeypatch):
    app, submitted_job, builder = submit_app
    builder.get_function_config.return_value = SimpleNamespace(
        tools=["knowledge_search_tool"],
        exclude_tools=[],
    )

    spy = MagicMock(wraps=job_data_sources.get_all_tool_refs)
    monkeypatch.setattr(job_data_sources, "get_all_tool_refs", spy)

    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs/async/submit",
            json={"agent_type": "deep_researcher", "input": "query", "data_sources": ["knowledge_layer"]},
        )

    assert response.status_code == 200
    spy.assert_not_called()
    builder.get_tools.assert_awaited_once()
    _, kwargs = builder.get_tools.await_args
    assert kwargs["tool_names"] == ["knowledge_search_tool"]
    submitted_job.assert_awaited_once()
