"""The base corpus is searched only where the knowledge context lets the read see a country (ADR-0173, ADR-0175).

Review of #1545, fix 1: a Bavarian project's "Brandschutz?" retrieved OIB-RL 2 as
building law. The project's own text no longer decides it: a profile naming
Austria with a gate that reads no country searches no base corpus, and one
naming Germany with a gate that reads Austria does.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from knowledge_layer.register import KnowledgeRetrievalConfig
from knowledge_layer.search import scoped_collections_for_site

from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import set_turn_knowledge_context

GERMAN = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=de\n"
AUSTRIAN = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=at\n- federal_state=tyrol\n"


@pytest.fixture(autouse=True)
def _unbound():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


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


@pytest.mark.parametrize("profile", [None, AUSTRIAN, GERMAN])
def test_a_gate_that_reads_austria_searches_the_base_corpus_whatever_the_profile_says(profile: str | None) -> None:
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", retrieval_countries=frozenset({"AT"})))
    assert _scope(profile)[0] == "oib_knowledge"


@pytest.mark.parametrize("gate", ["not_entitled", "knowledge_unavailable", "organization_unplaced"])
def test_a_gate_that_reads_no_country_searches_its_own_collections_only(gate: str) -> None:
    set_turn_knowledge_context(KnowledgeContext(gate=gate))
    assert _scope(AUSTRIAN) == ["s_1", "proj_1"]
