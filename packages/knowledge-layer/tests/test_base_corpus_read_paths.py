"""Every read path over the base corpus passes the country gate (ADR-0173, review of #1574 item 1).

The gate lives in one constructor, ``vector_store.scope.scope_filter``, which ANDs
``corpus_country_condition`` into every read of a shared-corpus scope. This file
holds that each path a turn, a run, a door tool or the estate reads the corpus by
reaches it, on a real Qdrant: the ranked search (chat, runs, ``knowledge_search``
and ``read_passage``, which reads through the retriever's search), the literal
search (the estate's ``grep``), the scroll (the estate's ``read_file`` and its
recall), the inventory (``file_names``, ``file_counts``, ``facet_counts``) and the
count (``browse``'s pre-filter). Each runs twice, the second time with the
condition dropped, so the leak it guards against is shown to be real.

The corpus holds an Austrian text, a German one and an unmarked one; the turn
may read Austria. The unmarked text is read by nobody (fail closed).
"""

from __future__ import annotations

import pytest
from knowledge_layer.vector_store import COUNTRY_FIELD
from knowledge_layer.vector_store import find_text
from knowledge_layer.vector_store import hybrid_search
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import vector
from knowledge_layer_testing.vector_store import write

from agent.common import knowledge_context
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import set_turn_knowledge_context

CORPUS = "oib_knowledge"
TEXT = "Fluchtweg Breite Stiegenhaus"
AUSTRIAN, GERMAN, UNMARKED = "OIB-RL4.pdf", "MBO.pdf", "Unmarked.pdf"

WITH_AND_WITHOUT = pytest.mark.parametrize("dropped", [False, True], ids=["gated", "condition-dropped"])


@pytest.fixture
def corpus(qdrant_store, monkeypatch):
    write(CORPUS, [record(TEXT, AUSTRIAN)], {COUNTRY_FIELD: "AT"})
    write(CORPUS, [record(TEXT, GERMAN)], {COUNTRY_FIELD: "DE"})
    write(CORPUS, [record(TEXT, UNMARKED)])  # a base-corpus job naming no country: stamped unreleased
    set_turn_knowledge_context(KnowledgeContext(gate="core", retrieval_countries=frozenset({"AT", "EU"})))
    yield qdrant_store
    set_turn_knowledge_context(None)


def _drop(monkeypatch, dropped: bool) -> None:
    if dropped:
        # As a read of no request: scope_filter then ANDs no country clause.
        monkeypatch.setattr(knowledge_context, "corpus_countries", lambda: knowledge_context.UNSCOPED)


def _expect(files: set[str], dropped: bool) -> None:
    assert AUSTRIAN in files
    assert (GERMAN in files) is dropped
    assert UNMARKED not in files or dropped


@WITH_AND_WITHOUT
def test_the_ranked_search_reads_only_the_gates_countries(corpus, monkeypatch, dropped):
    """Chat turns, runs, the door's knowledge_search and read_passage all read through it."""
    _drop(monkeypatch, dropped)
    hits = hybrid_search(corpus, [CORPUS], office_id=None, vector=vector(TEXT), lexical_text=TEXT, limit=10)
    _expect({hit.payload["file_name"] for hit in hits}, dropped)


@WITH_AND_WITHOUT
def test_the_literal_search_reads_only_the_gates_countries(corpus, monkeypatch, dropped):
    """The estate's grep."""
    _drop(monkeypatch, dropped)
    hits = find_text(CORPUS, r"(?i)fluchtweg", None, 50, office_id=None)
    _expect({hit.payload["file_name"] for hit in hits}, dropped)


@WITH_AND_WITHOUT
def test_a_scroll_reads_only_the_gates_countries(corpus, monkeypatch, dropped):
    """The estate's read_file and its recall."""
    _drop(monkeypatch, dropped)
    _expect({(point.payload or {}).get("file_name") for point in corpus.scroll(CORPUS, None)}, dropped)


@WITH_AND_WITHOUT
def test_the_inventory_lists_only_the_gates_countries(corpus, monkeypatch, dropped):
    """The estate's inventory: file names, file counts and facets."""
    _drop(monkeypatch, dropped)
    _expect(set(corpus.file_names(CORPUS)), dropped)
    _expect(set(corpus.file_counts(CORPUS)), dropped)
    _expect(set(corpus.facet_counts(CORPUS, "file_name")), dropped)


@WITH_AND_WITHOUT
def test_a_count_reads_only_the_gates_countries(corpus, monkeypatch, dropped):
    """browse's pre-filter counts before it reads."""
    _drop(monkeypatch, dropped)
    assert corpus.count(CORPUS) == (3 if dropped else 1)


@WITH_AND_WITHOUT
def test_the_filter_every_path_builds_admits_only_the_gates_countries_on_qdrant(monkeypatch, dropped):
    """The same constructor's semantics on Qdrant's local mode, which needs no server."""
    from knowledge_layer.vector_store import scope_filter
    from qdrant_client import QdrantClient
    from qdrant_client import models

    client = QdrantClient(":memory:")
    client.create_collection(
        "t", vectors_config={"dense": models.VectorParams(size=2, distance=models.Distance.COSINE)}
    )
    payloads = {
        1: {"scope": CORPUS, COUNTRY_FIELD: "AT"},
        2: {"scope": CORPUS, COUNTRY_FIELD: "DE"},
        3: {"scope": CORPUS, COUNTRY_FIELD: "ZZ"},
        4: {"scope": CORPUS},
        5: {"scope": "proj_1"},  # the office's own project, read beside the corpus, never narrowed
    }
    client.upsert("t", [models.PointStruct(id=i, vector={"dense": [1.0, 0.0]}, payload=p) for i, p in payloads.items()])
    set_turn_knowledge_context(KnowledgeContext(gate="core", retrieval_countries=frozenset({"AT"})))
    _drop(monkeypatch, dropped)
    try:
        result = client.query_points(
            "t", query=[1.0, 0.0], using="dense", query_filter=scope_filter([CORPUS, "proj_1"]), limit=10
        )
    finally:
        set_turn_knowledge_context(None)
    found = {int(point.id) for point in result.points}
    assert found == ({1, 2, 3, 4, 5} if dropped else {1, 5})


def _scope_filter_over_points(monkeypatch, request_fields):
    """The ids ``scope_filter`` admits from a corpus of marked and unmarked points, for one request's context."""
    from knowledge_layer.vector_store import scope_filter
    from qdrant_client import QdrantClient
    from qdrant_client import models

    from agent import project_context

    set_turn_knowledge_context(None)
    monkeypatch.setattr(
        project_context.RequestContext, "from_context", classmethod(lambda cls: cls(**request_fields)), raising=True
    )
    client = QdrantClient(":memory:")
    client.create_collection(
        "t", vectors_config={"dense": models.VectorParams(size=2, distance=models.Distance.COSINE)}
    )
    payloads = {
        1: {"scope": CORPUS, COUNTRY_FIELD: "QA"},
        2: {"scope": CORPUS, COUNTRY_FIELD: "QB"},
        3: {"scope": CORPUS, COUNTRY_FIELD: "ZZ"},
        4: {"scope": CORPUS},
    }
    client.upsert("t", [models.PointStruct(id=i, vector={"dense": [1.0, 0.0]}, payload=p) for i, p in payloads.items()])
    result = client.query_points("t", query=[1.0, 0.0], using="dense", query_filter=scope_filter([CORPUS]), limit=10)
    return {int(point.id) for point in result.points}


def test_a_request_whose_scope_names_no_countries_reads_no_base_chunk(monkeypatch):
    entry = {"collection": CORPUS, "shelf": "base"}
    fields = {"organization_id": "org_1", "collection_scope_entries": [entry]}
    assert _scope_filter_over_points(monkeypatch, fields) == set()


def test_a_script_with_no_request_still_reads_the_whole_corpus(monkeypatch):
    """Explicitly unscoped: the sync loop and offline jobs belong to no request."""
    assert _scope_filter_over_points(monkeypatch, {}) == {1, 2, 3, 4}


def test_an_entitled_request_reads_only_its_countries(monkeypatch):
    entry = {"collection": CORPUS, "shelf": "base", "countries": ["QA"]}
    fields = {"organization_id": "org_1", "collection_scope_entries": [entry]}
    assert _scope_filter_over_points(monkeypatch, fields) == {1}
