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
from knowledge_layer.vector_store import scope_filter
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


def _country(filter_: models.Filter) -> models.Filter | None:
    """The country clause :func:`scope_filter` ANDed in, or None."""
    return next((part for part in filter_.must if isinstance(part, models.Filter) and part.should), None)


def _reads(*countries: str) -> models.Filter:
    """The country clause for ``countries``: one of them, and not marked unreleased."""
    return models.Filter(
        must=[models.FieldCondition(key="country_id", match=models.MatchAny(any=list(countries)))],
        must_not=[models.FieldCondition(key="released", match=models.MatchValue(value=False))],
    )


def test_without_a_context_no_read_is_narrowed():
    assert _country(scope_filter(["oib_knowledge"])) is None
    assert base_collection_filters(_config(), None) == NO_PAGE_CHUNKS


def test_a_turn_reads_only_the_countries_its_gate_names_and_no_unmarked_chunk():
    _bind("AT", "EU")
    country = _country(scope_filter(["oib_knowledge"]))
    assert country == models.Filter(should=[_reads("AT", "EU")])


def test_an_office_scope_beside_the_corpus_is_never_narrowed():
    _bind("DE")
    country = _country(scope_filter(["oib_knowledge", "proj_1"]))
    assert country is not None and len(country.should) == 2
    assert _country(scope_filter(["proj_1"])) is None


def test_a_gate_that_reads_no_country_reads_no_corpus_chunk():
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled"))
    country = _country(scope_filter(["oib_knowledge"]))
    assert country == models.Filter(should=[_reads("__none__")])


def test_a_run_or_a_door_call_reads_the_countries_signed_onto_the_base_entry(monkeypatch):
    from agent.project_context import RequestContext

    signed = RequestContext(
        collection_scope_entries=[{"collection": "oib_knowledge", "shelf": "base", "countries": ["AT"]}]
    )
    monkeypatch.setattr(RequestContext, "from_context", classmethod(lambda cls: signed))
    country = _country(scope_filter(["oib_knowledge"]))
    assert country == models.Filter(should=[_reads("AT")])


@pytest.mark.parametrize(("entry", "readable"), [({"countries": []}, False), ({}, False)])
def test_a_base_entry_with_no_countries_or_an_empty_list_reads_nothing(monkeypatch, entry, readable):
    """An empty ``countries`` list fails closed, and so does a request whose base entry has no ``countries``
    at all: a request's silence is never "unscoped" (only a read of no request is, ``UNSCOPED``)."""
    from agent.common.knowledge_context import base_corpus_readable
    from agent.project_context import RequestContext

    signed = RequestContext(collection_scope_entries=[{"collection": "oib_knowledge", "shelf": "base", **entry}])
    monkeypatch.setattr(RequestContext, "from_context", classmethod(lambda cls: signed))
    assert base_corpus_readable() is readable


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


def test_an_ingest_job_stamps_its_country_and_an_unmarked_corpus_text_is_nobodys():
    stamped = enrichment("oib_knowledge", {"country_id": "DE", "knowledge_edition_id": "edition:baybo-2025"})
    assert stamped["country_id"] == "DE"
    assert stamped["knowledge_edition_id"] == "edition:baybo-2025"
    assert "released" not in stamped  # a job from before the flag: read by its country, as before
    for unmarked in ({"country_id": "Germany"}, {}):
        mark = enrichment("oib_knowledge", unmarked)
        assert "country_id" not in mark and mark["released"] is False
    assert enrichment("oib_knowledge", {"country_id": "DE", "released": True})["released"] is True
    withdrawn = enrichment("oib_knowledge", {"country_id": "DE", "released": False})
    assert withdrawn["country_id"] == "DE" and withdrawn["released"] is False
    office = enrichment("proj_1", {"organization_id": "org_1"})
    assert "country_id" not in office and "released" not in office
