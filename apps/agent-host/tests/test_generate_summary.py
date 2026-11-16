from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import httpx
import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes.generate_summary import add_generate_summary_routes


@pytest.fixture
def app():
    app = FastAPI()
    router = APIRouter()
    add_generate_summary_routes(router)
    app.include_router(router)
    return app


@pytest.fixture(autouse=True)
def _configured_llm_key(monkeypatch):
    monkeypatch.setenv("SUMMARY_LLM_API_KEY", "test-key")


def _fake_async_client(post_mock):
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.post = post_mock
    return MagicMock(return_value=client)


def _summary_response(content: str):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": content}}]}
    return mock_response


@pytest.mark.asyncio
async def test_generate_summary_success(app):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "A modern office renovation project."}}],
    }
    mock_post = AsyncMock(return_value=mock_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Project type: office renovation. Location: Vienna."},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "A modern office renovation project."
    assert data["error"] is None
    mock_post.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("zdr", [True, False])
async def test_the_request_follows_the_organizations_zdr_setting(app, monkeypatch, zdr):
    monkeypatch.setenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
    mock_post = AsyncMock(return_value=_summary_response("Ein Projekt."))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with (
            patch("httpx.AsyncClient", _fake_async_client(mock_post)),
            patch("agent.common.model_overrides.resolve_org_zdr_only", return_value=zdr),
            patch("agent.common.llm_credentials.resolve_org_llm_credential", return_value=None),
        ):
            await client.post(
                "/v1/generate-summary", json={"profile_text": "Büro."}, headers={"x-grid-organization-id": "org_1"}
            )

    sent = mock_post.call_args.kwargs["json"]
    assert ("provider" in sent and sent["provider"]["zdr"] is True) is zdr


@pytest.mark.asyncio
async def test_generate_summary_empty_profile_text(app):
    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-summary", json={"profile_text": "   "})

    assert response.status_code == 200
    assert response.json() == {"summary": "", "error": None}
    mock_post.assert_not_called()


@pytest.mark.asyncio
async def test_generate_summary_defaults_to_german(app):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": "Ein Projekt."}}]}
    mock_post = AsyncMock(return_value=mock_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Main use: Residential"},
            )

    assert response.status_code == 200
    payload = mock_post.call_args.kwargs["json"]
    user_content = payload["messages"][1]["content"]
    assert user_content.startswith("Write the summary in German.")
    assert "Main use: Residential" in user_content


@pytest.mark.asyncio
async def test_generate_summary_english_locale(app):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": "A project."}}]}
    mock_post = AsyncMock(return_value=mock_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Main use: Residential", "locale": "en"},
            )

    assert response.status_code == 200
    payload = mock_post.call_args.kwargs["json"]
    assert payload["messages"][1]["content"].startswith("Write the summary in English.")


@pytest.mark.asyncio
async def test_generate_summary_missing_field(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/generate-summary", json={})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generate_summary_null_choices_returns_malformed_not_500(app):
    null_choices = MagicMock(spec=httpx.Response)
    null_choices.status_code = 200
    null_choices.raise_for_status = MagicMock()
    null_choices.json.return_value = {"choices": None}
    mock_post = AsyncMock(return_value=null_choices)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Project type: office renovation."},
            )

    assert response.status_code == 200
    assert response.json() == {"summary": "", "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_generate_summary_llm_failure_returns_empty_summary(app):
    mock_post = AsyncMock(side_effect=httpx.RequestError("Connection refused"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Project type: office renovation."},
            )

    assert response.status_code == 200
    assert response.json() == {"summary": "", "error": "llm_request_failed"}


@pytest.mark.asyncio
async def test_generate_summary_upstream_error_returns_empty_summary(app):
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
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Project type: office renovation."},
            )

    assert response.status_code == 200
    assert response.json() == {"summary": "", "error": "llm_request_failed"}


@pytest.mark.asyncio
async def test_generate_summary_uses_byok_credential_when_org_header_present(app, monkeypatch):
    from agent.common.llm_credentials import OrgLLMCredential

    monkeypatch.delenv("SUMMARY_LLM_API_KEY", raising=False)
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
        return _summary_response("Tenant summary.")

    mock_post = AsyncMock(side_effect=_capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("agent.common.llm_credentials.resolve_org_llm_credential", return_value=byok):
            with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
                response = await client.post(
                    "/v1/generate-summary",
                    json={"profile_text": "Project type: office renovation."},
                    headers={"x-grid-organization-id": "org-1"},
                )

    assert response.status_code == 200
    assert response.json()["summary"] == "Tenant summary."
    assert captured["url"] == "https://tenant.example.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-tenant"


@pytest.mark.asyncio
async def test_generate_summary_env_fallback_when_byok_absent(app, monkeypatch):
    monkeypatch.setenv("SUMMARY_LLM_API_KEY", "env-key")

    captured: dict = {}

    async def _capture(url, json=None, headers=None):  # noqa: A002 - mirrors httpx kwarg
        captured["headers"] = headers
        return _summary_response("Env summary.")

    mock_post = AsyncMock(side_effect=_capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("agent.common.llm_credentials.resolve_org_llm_credential", return_value=None):
            with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
                response = await client.post(
                    "/v1/generate-summary",
                    json={"profile_text": "Project type: office renovation."},
                    headers={"x-grid-organization-id": "org-1"},
                )

    assert response.status_code == 200
    assert captured["headers"]["Authorization"] == "Bearer env-key"


@pytest.mark.asyncio
async def test_generate_summary_no_api_key_returns_not_configured(app, monkeypatch):
    monkeypatch.delenv("SUMMARY_LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-summary",
                json={"profile_text": "Project type: office renovation."},
            )

    assert response.status_code == 200
    assert response.json() == {"summary": "", "error": "llm_not_configured"}
    mock_post.assert_not_called()


def test_placeholder_openrouter_key_does_not_select_the_openrouter_endpoint(monkeypatch):
    from agent_host.routes.generate_summary import _llm_settings

    monkeypatch.setenv("OPENROUTER_API_KEY", "${OPENROUTER_API_KEY}")
    monkeypatch.setenv("LLM_API_KEY", "sk-some-other-provider")
    for name in ("SUMMARY_LLM_MODEL", "SUMMARY_LLM_BASE_URL", "SUMMARY_LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)

    cred = _llm_settings()

    assert "openrouter.ai" not in cred.base_url
    assert cred.base_url == "https://api.openai.com/v1"
    assert cred.model == "gpt-4o-mini"
    assert cred.api_key == "sk-some-other-provider"  # pragma: allowlist secret
