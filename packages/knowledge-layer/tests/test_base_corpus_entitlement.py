"""The base corpus reads only the countries the turn's gate lets it read (ADR-0173).

Audit of #1559, item 1: the shared corpus carried no country, so an office not
entitled to a country could still retrieve its chunks. A point carries
``country_id`` now; one written before it is Austrian.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from knowledge_layer.register import KnowledgeRetrievalConfig
from knowledge_layer.search import base_collection_filters
from knowledge_layer.search import scoped_collections_for_site
from knowledge_layer.vector_store import enrichment
from knowledge_layer.vector_store import translate
from qdrant_client import models

from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import set_turn_knowledge_context

NO_PAGE_CHUNKS = {"chunking": {"$ne": "page"}}
AUSTRIAN = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=at\n- federal_state=tyrol\n"


@pytest.fixture(autouse=True)
def _unbound():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


def _bind(*countries: str) -> None:
    set_turn_knowledge_context(KnowledgeContext(gate="core", retrieval_countries=frozenset(countries)))


def _config() -> KnowledgeRetrievalConfig:
    return KnowledgeRetrievalConfig(
        collection_name="oib_knowledge",
        include_base_collection=True,
        include_session_collection=True,
        project_collections=["proj_1"],
    )


def _scope(context: str | None) -> list[str]:
    with (
        patch("agent.knowledge.scoping.get_scoped_collections_from_context", return_value=None),
        patch("agent.project_context.get_profile_context_from_context", return_value=context),
    ):
        return [entry.collection for entry in scoped_collections_for_site(_config(), "s_1")]


def test_without_a_context_the_filter_is_what_it_was():
    assert base_collection_filters(_config(), None) == NO_PAGE_CHUNKS


def test_an_austrian_turn_reads_austria_and_the_points_written_before_the_country():
    _bind("AT", "EU")
    assert base_collection_filters(_config(), None) == {
        "$and": [NO_PAGE_CHUNKS, {"$or": [{"country_id": {"$in": ["AT", "EU"]}}, {"country_id": {"$exists": False}}]}]
    }


def test_a_turn_not_entitled_to_austria_reads_none_of_the_older_points():
    _bind("DE")
    assert base_collection_filters(_config(), None) == {"$and": [NO_PAGE_CHUNKS, {"country_id": {"$in": ["DE"]}}]}


def test_a_gate_that_reads_no_country_drops_the_base_corpus_even_for_an_austrian_site():
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled"))
    assert _scope(AUSTRIAN) == ["s_1", "proj_1"]


def test_a_gate_that_reads_a_country_keeps_the_base_corpus_for_its_filter():
    _bind("DE")
    assert _scope("PROJECT_CONTEXT v1\n\nconfirmed:\n- country=de\n")[0] == "oib_knowledge"


def test_exists_translates_to_qdrant_is_empty():
    missing = translate({"country_id": {"$exists": False}})
    present = translate({"country_id": {"$exists": True}})
    empty = models.IsEmptyCondition(is_empty=models.PayloadField(key="country_id"))
    assert missing == models.Filter(must=[empty])
    assert present == models.Filter(must_not=[empty])
    with pytest.raises(ValueError):
        translate({"country_id": {"$exists": "no"}})


def test_an_ingest_job_stamps_its_country_and_refuses_a_malformed_one():
    stamped = enrichment("oib_knowledge", {"country_id": "DE", "knowledge_edition_id": "edition:baybo-2025"})
    assert stamped["country_id"] == "DE"
    assert stamped["knowledge_edition_id"] == "edition:baybo-2025"
    assert "country_id" not in enrichment("oib_knowledge", {"country_id": "Germany"})
