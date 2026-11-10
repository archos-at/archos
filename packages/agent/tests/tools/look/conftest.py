"""The canvas tests' turn, envelope and HTTP fakes: ``look`` resolves its document the way the canvas tools do."""

import pytest  # noqa: E402
from agent_testing.canvas import calls  # noqa: F401 - fixtures, re-exported for this directory
from agent_testing.canvas import lookups  # noqa: F401
from agent_testing.canvas import registry  # noqa: F401
from agent_testing.canvas import turn  # noqa: F401


@pytest.fixture(autouse=True)
def _unmarked_documents(monkeypatch):
    """Every looked-at document carries no licence unless a test says so: the lookup reads Qdrant, which these
    tests do not run, and fails closed (``place.document_licence``)."""
    from agent.tools.look import register

    monkeypatch.setattr(register, "document_licence", lambda collection, file_name, unindexed=None: None)
