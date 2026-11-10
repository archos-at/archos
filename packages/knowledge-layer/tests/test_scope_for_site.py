"""The Austrian corpus is searched for an Austrian site, or a turn without a project (ADR-0158).

Review of #1545, fix 1: a Bavarian project's "Brandschutz?" retrieved OIB-RL 2 as
building law. The BFF leaves the base corpus out of such a project's scope; this
holds the same rule for a scope the BFF did not state.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from knowledge_layer.register import KnowledgeRetrievalConfig
from knowledge_layer.search import scoped_collections_for_site

GERMAN = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=de\n"
AUSTRIAN = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=at\n- federal_state=tyrol\n"


def _scope(context: str | None) -> list[str]:
    config = KnowledgeRetrievalConfig(
        collection_name="oib_knowledge",
        include_base_collection=True,
        include_session_collection=True,
        project_collections=["proj_1"],
    )
    with (
        patch("agent.knowledge.scoping.get_scoped_collections_from_context", return_value=None),
        patch("agent.project_context.get_profile_context_from_context", return_value=context),
    ):
        return [entry.collection for entry in scoped_collections_for_site(config, "s_1")]


@pytest.mark.parametrize("context", [None, AUSTRIAN])
def test_the_base_corpus_serves_an_austrian_site_or_no_project(context: str | None) -> None:
    assert _scope(context)[0] == "oib_knowledge"


def test_a_project_abroad_searches_its_own_collections_only() -> None:
    assert _scope(GERMAN) == ["s_1", "proj_1"]
