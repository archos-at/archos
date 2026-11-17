from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_host.routes.config_info import add_config_info_routes


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    router = APIRouter()
    llm_configs = {
        "chat_llm": SimpleNamespace(
            model_name="deepseek/deepseek-v4-flash",
            base_url="https://openrouter.ai/api/v1",
            reasoning_effort="none",
        ),
        "card_llm": SimpleNamespace(
            model_name="deepseek/deepseek-v4-flash",
            base_url="https://openrouter.ai/api/v1",
            reasoning_effort="medium",
        ),
        "weird_llm": SimpleNamespace(),  # no model/base_url/effort field → None
    }
    add_config_info_routes(router, llm_configs)
    app.include_router(router)
    return TestClient(app)


def test_returns_llm_defaults_without_token_in_dev(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    response = client.get("/v1/config/llm-defaults")
    assert response.status_code == 200
    llms = response.json()["llms"]
    assert llms["chat_llm"] == "deepseek/deepseek-v4-flash"
    assert llms["card_llm"] == "deepseek/deepseek-v4-flash"
    assert llms["weird_llm"] is None
    assert isinstance(llms["vlm"], str) and llms["vlm"]


def test_reports_the_base_url_each_llm_targets(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    base_urls = client.get("/v1/config/llm-defaults").json()["baseUrls"]

    assert base_urls["chat_llm"] == "https://openrouter.ai/api/v1"
    assert base_urls["card_llm"] == "https://openrouter.ai/api/v1"
    assert base_urls["weird_llm"] is None
    assert isinstance(base_urls["vlm"], str) and base_urls["vlm"]


def test_vlm_default_reflects_env(monkeypatch):
    monkeypatch.setenv("VLM_MODEL", "vendor/vision-x")
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    app = FastAPI()
    router = APIRouter()
    add_config_info_routes(router, {})
    app.include_router(router)
    client = TestClient(app)

    assert client.get("/v1/config/llm-defaults").json()["llms"]["vlm"] == "vendor/vision-x"


def test_requires_matching_token_when_configured(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token")

    assert client.get("/v1/config/llm-defaults").status_code == 403
    assert client.get("/v1/config/llm-defaults", headers={"x-grid-internal-token": "wrong"}).status_code == 403

    ok = client.get("/v1/config/llm-defaults", headers={"x-grid-internal-token": "secret-token"})
    assert ok.status_code == 200
    assert ok.json()["llms"]["chat_llm"] == "deepseek/deepseek-v4-flash"


def test_reads_the_token_under_the_new_name_as_well(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token")

    assert client.get("/v1/config/llm-defaults", headers={"x-internal-token": "wrong"}).status_code == 403
    assert client.get("/v1/config/llm-defaults", headers={"x-internal-token": "secret-token"}).status_code == 200


def test_reports_the_reasoning_effort_each_llm_ships_with(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    efforts = client.get("/v1/config/llm-defaults").json()["reasoningEfforts"]

    assert efforts["chat_llm"] == "none"
    assert efforts["card_llm"] == "medium"
    assert efforts["weird_llm"] is None
