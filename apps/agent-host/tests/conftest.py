from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from knowledge_layer_testing.vector_store_fixtures import fresh_qdrant_store  # noqa: F401 - a store of its own
from knowledge_layer_testing.vector_store_fixtures import qdrant_store  # noqa: F401 - the shared store fixture

_SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
_PKG_DIR = _SRC_ROOT / "agent_host"

if _PKG_DIR.is_dir():
    if str(_SRC_ROOT) not in sys.path:
        sys.path.insert(0, str(_SRC_ROOT))

    if "agent_host" not in sys.modules:
        _pkg = types.ModuleType("agent_host")
        _pkg.__path__ = [str(_PKG_DIR)]
        sys.modules["agent_host"] = _pkg


@pytest.fixture(autouse=True)
def _no_retry_pauses(monkeypatch):
    from agent_host import internal_retry

    async def _instant(_seconds: float) -> None:
        return None

    monkeypatch.setattr(internal_retry, "_sleep", _instant)


@pytest.fixture(autouse=True)
def _no_live_decisions(monkeypatch):
    monkeypatch.setenv("DECISIONS_ENABLED", "false")


_TEST_KEK = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="


@pytest.fixture(autouse=True)
def hatchet(monkeypatch):
    from agent.common import orchestrator_client
    from agent_host.jobs import research_workflow

    from .orchestrator_fake import FakeHatchet

    monkeypatch.setenv("JOB_PAYLOAD_KEK", _TEST_KEK)
    fake = FakeHatchet()
    orchestrator_client.reset_for_tests(fake)
    research_workflow._declared.clear()
    yield fake
    orchestrator_client.reset_for_tests(None)
    research_workflow._declared.clear()
