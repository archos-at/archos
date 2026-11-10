"""The evals that run the agent in their own processes bring a public-source fetcher with them.

Every backend role reads public sources only through the fetcher (ADR-0162
amendment). ``task be:eval:answer-suite`` and the census run the agent with no
deployment around it, so without one every Austrian law lookup in them would be
refused: ``scripts/turn_census/local_fetcher.py`` starts one for them.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "turn_census"))

import local_fetcher  # noqa: E402


@pytest.fixture
def fresh(monkeypatch):
    monkeypatch.delenv(local_fetcher.ENV_FETCHER_URL, raising=False)
    monkeypatch.setattr(local_fetcher, "_started", {})


def test_a_run_without_a_fetcher_gets_one_that_answers(fresh):
    env = local_fetcher.fetcher_env(sys.executable, REPO_ROOT)

    url = env[local_fetcher.ENV_FETCHER_URL]
    with urllib.request.urlopen(f"{url}/healthz", timeout=5) as answer:  # noqa: S310 - the local fetcher
        assert json.load(answer) == {"ok": True}
    # Started once: the next run shares it.
    assert local_fetcher.fetcher_env(sys.executable, REPO_ROOT) == env


def test_a_configured_fetcher_is_kept(fresh, monkeypatch):
    monkeypatch.setenv(local_fetcher.ENV_FETCHER_URL, "http://public-source-fetcher:8095")

    assert local_fetcher.fetcher_env(sys.executable, REPO_ROOT) == {}


def test_every_census_run_carries_the_fetcher(fresh, monkeypatch, tmp_path):
    import census

    seen: list[dict] = []

    class Ended:
        def __init__(self, cmd, **kwargs):
            seen.append(kwargs["env"])

        def poll(self):
            return 0

    monkeypatch.setattr(census, "fetcher_env", lambda python, root: {local_fetcher.ENV_FETCHER_URL: "http://here"})
    monkeypatch.setattr(census.subprocess, "Popen", Ended)
    monkeypatch.setattr(census, "_stop", lambda proc: None)

    census.run_once("Was gilt?", tmp_path, "conversation-1")

    assert seen[0][local_fetcher.ENV_FETCHER_URL] == "http://here"
