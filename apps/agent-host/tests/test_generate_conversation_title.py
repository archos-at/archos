from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import httpx
import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes.generate_conversation_title import add_generate_conversation_title_routes


@pytest.fixture
def app():
    app = FastAPI()
    router = APIRouter()
    add_generate_conversation_title_routes(router)
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


def _title_response(content: str, finish_reason: str = "stop"):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]}
    return mock_response


_BODY = {
    "messages": [
        {"role": "user", "content": "Welche Brandschutzanforderungen gelten für Stiegenhäuser über 22 m?"},
        {"role": "assistant", "content": "Für Gebäude über 22 m gelten laut OIB 2 …"},
    ],
    "allowed_tags": ["fire_safety", "sound_insulation", "structural"],
}


@pytest.mark.asyncio
async def test_success_returns_title_and_filtered_tags(app):
    mock_post = AsyncMock(
        return_value=_title_response(
            '{"title": "Brandschutz bei Stiegenhäusern", "tags": ["fire_safety", "fire_safety", "unknown-tag"]}'
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Brandschutz bei Stiegenhäusern"
    assert data["tags"] == ["fire_safety"]
    assert data["error"] is None


@pytest.mark.asyncio
async def test_parses_json_wrapped_in_code_fence(app):
    mock_post = AsyncMock(
        return_value=_title_response('```json\n{"title": "Schallschutz Wohnbau", "tags": ["sound_insulation"]}\n```')
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    data = response.json()
    assert data["title"] == "Schallschutz Wohnbau"
    assert data["tags"] == ["sound_insulation"]


@pytest.mark.asyncio
async def test_parses_json_in_unterminated_code_fence(app):
    mock_post = AsyncMock(
        return_value=_title_response('```json\n{"title": "Schallschutz Wohnbau", "tags": ["sound_insulation"]}')
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.json()["title"] == "Schallschutz Wohnbau"


@pytest.mark.asyncio
async def test_parses_json_surrounded_by_prose(app):
    mock_post = AsyncMock(
        return_value=_title_response(
            "Sure! Here is the JSON you asked for:\n"
            '{"title": "Brandschutz Stiegenhaus", "tags": ["fire_safety"]}\n'
            "Hope that helps :}"
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    data = response.json()
    assert data["title"] == "Brandschutz Stiegenhaus"
    assert data["tags"] == ["fire_safety"]
    assert data["error"] is None


@pytest.mark.asyncio
async def test_brace_inside_title_does_not_end_the_object(app):
    mock_post = AsyncMock(
        return_value=_title_response('{"title": "Regel {OIB 2} für Stiegen", "tags": ["fire_safety"]}')
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    data = response.json()
    assert data["title"] == "Regel {OIB 2} für Stiegen"
    assert data["tags"] == ["fire_safety"]


@pytest.mark.asyncio
async def test_reply_truncated_mid_title_is_recovered(app):
    mock_post = AsyncMock(
        return_value=_title_response('{"title": "Brandschutzanforderungen für Stiegen', finish_reason="length")
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    data = response.json()
    assert data["title"] == "Brandschutzanforderungen für Stiegen"
    assert data["tags"] == []
    assert data["error"] is None


@pytest.mark.asyncio
async def test_reply_truncated_mid_tag_list_is_recovered(app):
    mock_post = AsyncMock(
        return_value=_title_response('{"title": "Brandschutz Stiegen", "tags": ["fire_safety", "sta', "length")
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    data = response.json()
    assert data["title"] == "Brandschutz Stiegen"
    assert data["tags"] == ["fire_safety"]
    assert data["error"] is None


@pytest.mark.asyncio
async def test_reply_truncated_after_a_trailing_comma_is_recovered(app):
    mock_post = AsyncMock(return_value=_title_response('{"title": "Brandschutz Stiegen", ', "length"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.json()["title"] == "Brandschutz Stiegen"


@pytest.mark.asyncio
async def test_bare_title_string_is_not_accepted_as_a_title(app):
    mock_post = AsyncMock(return_value=_title_response("Brandschutz bei Stiegenhäusern"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.json() == {"title": "", "tags": [], "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_truncated_beyond_repair_is_still_reported(app):
    mock_post = AsyncMock(return_value=_title_response('{"title":', "length"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.json() == {"title": "", "tags": [], "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_request_constrains_the_endpoint_to_json(app):
    mock_post = AsyncMock(return_value=_title_response('{"title": "Brandschutz", "tags": []}'))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            await client.post("/v1/generate-conversation-title", json=_BODY)

    payload = mock_post.call_args.kwargs["json"]
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["max_tokens"] >= 300


@pytest.mark.asyncio
async def test_empty_messages_short_circuits(app):
    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post(
                "/v1/generate-conversation-title",
                json={"messages": [{"role": "user", "content": "   "}], "allowed_tags": ["fire_safety"]},
            )

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": None}
    mock_post.assert_not_called()


@pytest.mark.asyncio
async def test_malformed_json_returns_error_code(app):
    mock_post = AsyncMock(return_value=_title_response("Sorry, I cannot do that."))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_null_choices_returns_malformed_not_500(app):
    null_choices = MagicMock(spec=httpx.Response)
    null_choices.status_code = 200
    null_choices.raise_for_status = MagicMock()
    null_choices.json.return_value = {"choices": None}
    mock_post = AsyncMock(return_value=null_choices)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_null_content_returns_malformed_not_500(app):
    mock_post = AsyncMock(return_value=_title_response(None))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": "llm_response_malformed"}


@pytest.mark.asyncio
async def test_llm_failure_is_swallowed(app):
    mock_post = AsyncMock(side_effect=httpx.RequestError("Connection refused"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": "llm_request_failed"}


@pytest.mark.asyncio
async def test_no_api_key_returns_not_configured(app, monkeypatch):
    monkeypatch.delenv("SUMMARY_LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    mock_post = AsyncMock()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            response = await client.post("/v1/generate-conversation-title", json=_BODY)

    assert response.status_code == 200
    assert response.json() == {"title": "", "tags": [], "error": "llm_not_configured"}
    mock_post.assert_not_called()


@pytest.mark.asyncio
async def test_title_written_in_english_for_en_locale(app):
    mock_post = AsyncMock(return_value=_title_response('{"title": "Fire safety stairwells", "tags": []}'))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("httpx.AsyncClient", _fake_async_client(mock_post)):
            await client.post(
                "/v1/generate-conversation-title",
                json={**_BODY, "locale": "en"},
            )

    payload = mock_post.call_args.kwargs["json"]
    assert "Write the title in English." in payload["messages"][1]["content"]
