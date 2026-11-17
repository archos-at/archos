import pytest
from knowledge_layer.ingest import resolve_vlm_api_key
from knowledge_layer.ingest import vlm_configured


@pytest.fixture(autouse=True)
def _clear_vlm_env(monkeypatch):
    monkeypatch.delenv("VLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("VLM_BASE_URL", raising=False)


def test_resolves_explicit_vlm_key(monkeypatch):
    monkeypatch.setenv("VLM_API_KEY", "vlm-secret")
    assert resolve_vlm_api_key() == "vlm-secret"
    assert vlm_configured() is True


def test_the_default_base_url_infers_the_openrouter_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-secret")
    assert resolve_vlm_api_key() == "or-secret"
    assert vlm_configured() is True


def test_explicit_key_wins_over_the_inferred_one(monkeypatch):
    monkeypatch.setenv("VLM_API_KEY", "vlm-secret")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-secret")
    assert resolve_vlm_api_key() == "vlm-secret"


def test_no_key_configured_reports_unavailable():
    assert resolve_vlm_api_key() == ""
    assert vlm_configured() is False


def test_unresolved_placeholder_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv("VLM_API_KEY", "${OPENROUTER_API_KEY}")
    assert resolve_vlm_api_key() == ""
    assert vlm_configured() is False


def test_openrouter_base_infers_openrouter_key(monkeypatch):
    monkeypatch.setenv("VLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-secret")
    assert resolve_vlm_api_key() == "or-secret"
    assert vlm_configured() is True
