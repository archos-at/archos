import json
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import httpx
import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes.consistency_check import add_consistency_check_routes


@pytest.fixture
def app():
    app = FastAPI()
    router = APIRouter()
    add_consistency_check_routes(router)
    app.include_router(router)
    return app


@pytest.fixture(autouse=True)
def _configured_llm_key(monkeypatch):
    monkeypatch.setenv("CONSISTENCY_LLM_API_KEY", "test-key")


def _fake_async_client(post_mock):
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.post = post_mock
    return MagicMock(return_value=client)


def _llm_response(content: str):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": content}}]}
    return mock_response


_FREE_TEXT = [{"field": "Tell Grid more", "value": "This is an eight-storey tower with a rooftop bar."}]
_STRUCTURED = [
    {"field": "Building class", "value": "GK1"},
    {"field": "Above-ground floors", "value": "2"},
]


def _body(**overrides):
    body = {"free_text": _FREE_TEXT, "structured": _STRUCTURED, "locale": "en"}
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_consistency_check_returns_findings(app):
    content = json.dumps(
        {
            "findings": [
                {
                    "fields": ["Tell Grid more", "Above-ground floors"],
                    "severity": "inconsistency",
                    "explanation": "The note describes an eight-storey tower but the floor count says two.",
                }
            ]
        }
    )
    mock_post = AsyncMock(return_value=_llm_response(content))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    assert len(data["findings"]) == 1
    finding = data["findings"][0]
    assert finding["severity"] == "inconsistency"
    assert finding["fields"] == ["Tell Grid more", "Above-ground floors"]
    assert "eight" in finding["explanation"]
    mock_post.assert_called_once()


@pytest.mark.asyncio
async def test_free_text_and_structured_are_sent_to_the_model(app):
    captured: dict = {}

    async def _capture(url, json=None, headers=None):  # noqa: A002 - mirrors httpx kwarg
        captured["payload"] = json
        return _llm_response('{"findings": []}')

    mock_post = AsyncMock(side_effect=_capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    user_turn = captured["payload"]["messages"][1]["content"]
    assert "Free-text answers" in user_turn
    assert "eight-storey tower" in user_turn
    assert "read-only context" in user_turn
    assert "Building class: GK1" in user_turn


@pytest.mark.asyncio
async def test_consistency_check_empty_findings_when_consistent(app):
    mock_post = AsyncMock(return_value=_llm_response(json.dumps({"findings": []})))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": [], "error": None}


@pytest.mark.asyncio
async def test_consistency_check_tolerates_code_fenced_json(app):
    inner = json.dumps(
        {"findings": [{"fields": ["Tell Grid more"], "severity": "warning", "explanation": "Double-check."}]}
    )
    mock_post = AsyncMock(return_value=_llm_response(f"```json\n{inner}\n```"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    assert len(data["findings"]) == 1
    assert data["findings"][0]["severity"] == "warning"


@pytest.mark.asyncio
async def test_consistency_check_defaults_invalid_severity_and_skips_bad_findings(app):
    content = json.dumps(
        {
            "findings": [
                {"fields": ["A"], "severity": "critical", "explanation": "Odd but present."},
                {"fields": ["B"], "severity": "inconsistency"},  # no explanation -> skipped
                {"severity": "warning", "explanation": "   "},  # blank explanation -> skipped
            ]
        }
    )
    mock_post = AsyncMock(return_value=_llm_response(content))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    data = response.json()
    assert len(data["findings"]) == 1
    assert data["findings"][0]["severity"] == "warning"
    assert data["findings"][0]["fields"] == ["A"]


@pytest.mark.asyncio
async def test_consistency_check_no_free_text_short_circuits(app):
    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json={"free_text": [], "structured": _STRUCTURED})

    assert response.status_code == 200
    assert response.json() == {"findings": [], "error": None}
    mock_post.assert_not_called()


@pytest.mark.asyncio
async def test_consistency_check_malformed_json_returns_error_and_null_findings(app):
    mock_post = AsyncMock(return_value=_llm_response("Sorry, I cannot help with that."))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": None, "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_consistency_check_unexpected_shape_returns_malformed(app):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"unexpected": True}
    mock_post = AsyncMock(return_value=mock_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": None, "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_consistency_check_llm_failure_returns_error(app):
    mock_post = AsyncMock(side_effect=httpx.RequestError("Connection refused"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": None, "error": "llm_request_failed"}


@pytest.mark.asyncio
async def test_consistency_check_upstream_error_returns_error(app):
    error_response = MagicMock(spec=httpx.Response)
    error_response.status_code = 500
    error_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500 Internal Server Error",
        request=MagicMock(),
        response=error_response,
    )
    mock_post = AsyncMock(return_value=error_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": None, "error": "llm_request_failed"}


@pytest.mark.asyncio
async def test_consistency_check_uses_byok_credential_when_org_header_present(app, monkeypatch):
    from agent.common.llm_credentials import OrgLLMCredential

    monkeypatch.delenv("CONSISTENCY_LLM_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "platform-key")

    byok = OrgLLMCredential(
        credential_id="cred-1",
        provider="openrouter",
        base_url="https://tenant.example.com/v1",
        api_key="sk-tenant",
        key_fingerprint="fp",
    )

    captured: dict = {}

    async def _capture(url, json=None, headers=None):  # noqa: A002 - mirrors httpx kwarg
        captured["url"] = url
        captured["headers"] = headers
        return _llm_response('{"findings": []}')

    mock_post = AsyncMock(side_effect=_capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("agent.common.llm_credentials.resolve_org_llm_credential", return_value=byok):
            with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
                response = await client.post(
                    "/v1/consistency-check", json=_body(), headers={"x-grid-organization-id": "org-1"}
                )

    assert response.status_code == 200
    assert captured["url"] == "https://tenant.example.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-tenant"


@pytest.mark.asyncio
async def test_consistency_check_env_fallback_when_byok_absent(app, monkeypatch):
    monkeypatch.setenv("CONSISTENCY_LLM_API_KEY", "env-key")

    captured: dict = {}

    async def _capture(url, json=None, headers=None):  # noqa: A002 - mirrors httpx kwarg
        captured["headers"] = headers
        return _llm_response('{"findings": []}')

    mock_post = AsyncMock(side_effect=_capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("agent.common.llm_credentials.resolve_org_llm_credential", return_value=None):
            with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
                response = await client.post(
                    "/v1/consistency-check", json=_body(), headers={"x-grid-organization-id": "org-1"}
                )

    assert response.status_code == 200
    assert captured["headers"]["Authorization"] == "Bearer env-key"


@pytest.mark.asyncio
async def test_consistency_check_no_api_key_returns_not_configured(app, monkeypatch):
    monkeypatch.delenv("CONSISTENCY_LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    assert response.status_code == 200
    assert response.json() == {"findings": None, "error": "llm_not_configured"}
    mock_post.assert_not_called()


@pytest.mark.asyncio
async def test_prose_around_the_object_is_tolerated(app):
    content = (
        "Here is my assessment:\n"
        + json.dumps(
            {
                "findings": [
                    {
                        "fields": ["Tell Grid more"],
                        "severity": "inconsistency",
                        "explanation": "Eight storeys contradicts two above-ground floors.",
                    }
                ]
            }
        )
        + "\nLet me know if you need more detail."
    )
    mock_post = AsyncMock(return_value=_llm_response(content))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    data = response.json()
    assert data["error"] is None
    assert len(data["findings"]) == 1
    assert data["findings"][0]["severity"] == "inconsistency"


@pytest.mark.asyncio
async def test_reply_truncated_by_the_token_cap_is_recovered(app):
    content = (
        '{"findings": [{"fields": ["Tell Grid more"], "severity": "warning", '
        '"explanation": "Eight storeys contradicts two above-ground floors."}, '
        '{"fields": ["Tell Grid more"], "severity": "warning", "explanation": "A rooftop bar in a GK1'
    )
    mock_post = AsyncMock(return_value=_llm_response(content))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/consistency-check", json=_body())

    data = response.json()
    assert data["error"] is None
    assert len(data["findings"]) == 2
    assert data["findings"][1]["explanation"] == "A rooftop bar in a GK1"


def test_placeholder_openrouter_key_does_not_select_the_openrouter_endpoint(monkeypatch):
    from agent_host.routes.consistency_check import _llm_settings

    monkeypatch.setenv("OPENROUTER_API_KEY", "${OPENROUTER_API_KEY}")
    monkeypatch.setenv("LLM_API_KEY", "sk-some-other-provider")
    for name in (
        "CONSISTENCY_LLM_MODEL",
        "CONSISTENCY_LLM_BASE_URL",
        "CONSISTENCY_LLM_API_KEY",
        "LLM_MODEL",
        "LLM_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)

    cred = _llm_settings()

    assert "openrouter.ai" not in cred.base_url
    assert cred.base_url == "https://api.openai.com/v1"
    assert cred.model == "gpt-4o-mini"
    assert cred.api_key == "sk-some-other-provider"  # pragma: allowlist secret
