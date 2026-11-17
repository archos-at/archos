from __future__ import annotations

from pathlib import Path

import pytest
import yaml

COMPOSE_DIR = Path(__file__).resolve().parents[1] / "deploy" / "compose"
FILES = ["docker-compose.yaml"]
CALLERS = ("chat", "api", "agent-worker")
FETCHER = "public-source-fetcher"


def _services(name: str) -> dict:
    return yaml.safe_load((COMPOSE_DIR / name).read_text())["services"]


def _environment(services: dict, service: str) -> str:
    definition = services[service]
    parent = (definition.get("extends") or {}).get("service")
    own = yaml.safe_dump(definition.get("environment") or {})
    return own + (_environment(services, parent) if parent else "")


@pytest.mark.parametrize("name", FILES)
def test_the_fetcher_runs_the_fetcher_module_with_no_secrets(name):
    fetcher = _services(name)[FETCHER]
    assert fetcher["command"][-2:] == ["-m", "public_sources.fetcher"]
    assert "env_file" not in fetcher


@pytest.mark.parametrize("name", FILES)
@pytest.mark.parametrize("caller", CALLERS)
def test_every_caller_knows_the_fetcher_and_starts_it_without_waiting_on_it(name, caller):
    services = _services(name)
    assert "PUBLIC_SOURCE_FETCHER_URL" in _environment(services, caller)
    assert "http://public-source-fetcher:8095" in _environment(services, caller)
    assert services[caller]["depends_on"][FETCHER] == {"condition": "service_started"}


def _networks(service: dict) -> set[str]:
    networks = service.get("networks") or []
    return set(networks if isinstance(networks, list) else networks.keys())


def test_the_fetcher_shares_a_network_with_its_callers_and_no_store():
    services = _services("docker-compose.yaml")
    assert _networks(services[FETCHER]) == {"public-sources"}
    for caller in CALLERS:
        assert "public-sources" in _networks(services[caller])
    on_it = {name for name, service in services.items() if "public-sources" in _networks(service)}
    assert on_it == {FETCHER, *CALLERS}
