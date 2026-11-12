"""Retrieval prefers the editions that bind at the turn's site, and never requires them (country-as-data row 7).

The same rule in two editions (the 2019 and the 2023 Ausgabe of one Richtlinie) is the same words, so
the two passages score alike and rank by chance. The answer then cites the edition that does not bind,
the citation check removes it after the answer is written, and the reader gets a value with no source.
Every corpus point carries ``knowledge_edition_id``; the turn's knowledge context names the editions that
bind (``knowledge_context.binding_editions``), and each ranked read rescores every channel by them
(``boost.ranking_formula``). A boost, not a filter: the other edition stays a candidate, so a question
about the 2019 edition still finds it.

The formula's semantics run on Qdrant's local mode, which needs no server; the two ranked reads
(``hybrid_search`` and ``grouped_search``) run on a real Qdrant when ``QDRANT_TEST_URL`` names one.
"""

from __future__ import annotations

import pytest
from knowledge_layer.vector_store import EDITION_PREFERENCE
from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
from knowledge_layer.vector_store import boosted
from knowledge_layer.vector_store import grouped_search
from knowledge_layer.vector_store import hybrid_search
from knowledge_layer.vector_store import ranking_formula
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import vector
from knowledge_layer_testing.vector_store import write
from qdrant_client import QdrantClient
from qdrant_client import models

from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import binding_editions
from agent.common.knowledge_context import set_turn_knowledge_context

CORPUS = "oib_knowledge"
OLD, NEW = "edition:rl4-2019", "edition:rl4-2023"
TEXT = "Fluchtwege Mindestbreite Stiegenhaus 1,20 m"


@pytest.fixture(autouse=True)
def _unbound():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


def _bind(*editions: str, role: str = "binding") -> None:
    uses = tuple(EditionUse(work_id="work:rl4", edition_id=edition, role=role, via="territory") for edition in editions)
    set_turn_knowledge_context(KnowledgeContext(gate="core", retrieval_countries=frozenset({"XA"}), uses=uses))


def test_the_turn_names_only_its_binding_editions():
    assert binding_editions() == frozenset()
    _bind(NEW)
    assert binding_editions() == {NEW}
    _bind(OLD, role="guidance")
    assert binding_editions() == frozenset()
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", uses=(EditionUse(work_id="w", edition_id=None, role="binding", via="territory"),))
    )
    assert binding_editions() == frozenset()  # law read live holds no edition to prefer


def test_no_binding_edition_rescores_nothing():
    assert ranking_formula(None, ()) is None
    channel = models.Prefetch(query=[1.0, 0.0], using="dense", limit=5)
    assert boosted(channel, ranking_formula(None, ())) is channel


def _local(points: dict[int, tuple[list[float], dict]]) -> QdrantClient:
    client = QdrantClient(":memory:")
    client.create_collection(
        "t", vectors_config={"dense": models.VectorParams(size=2, distance=models.Distance.COSINE)}
    )
    client.upsert("t", [models.PointStruct(id=i, vector={"dense": v}, payload=p) for i, (v, p) in points.items()])
    return client


def _ranked(client: QdrantClient, editions: frozenset[str]) -> list[int]:
    channel = models.Prefetch(query=[1.0, 0.0], using="dense", limit=10)
    result = client.query_points(
        "t",
        prefetch=[boosted(channel, ranking_formula(None, editions))],
        query=models.RrfQuery(rrf=models.Rrf(k=60)),
        limit=10,
    )
    return [int(point.id) for point in result.points]


TWINS = {
    1: ([1.0, 0.0], {KNOWLEDGE_EDITION_FIELD: OLD}),
    2: ([1.0, 0.0], {KNOWLEDGE_EDITION_FIELD: NEW}),
}


@pytest.mark.parametrize("binding", [OLD, NEW])
def test_of_two_identical_passages_the_binding_editions_ranks_first(binding):
    order = _ranked(_local(TWINS), frozenset({binding}))
    assert order[0] == (1 if binding == OLD else 2)
    assert set(order) == {1, 2}  # a preference, never a filter


def test_a_clearly_better_passage_of_another_edition_still_ranks_first():
    """A question about the 2019 edition: its passage answers it clearly better, and is not outranked."""
    cosine_gap = 0.3  # well beyond EDITION_PREFERENCE of its own score
    assert cosine_gap > EDITION_PREFERENCE
    points = {
        1: ([1.0, 0.0], {KNOWLEDGE_EDITION_FIELD: OLD}),
        2: ([1.0, 1.0 - cosine_gap * 2], {KNOWLEDGE_EDITION_FIELD: NEW}),
    }
    assert _ranked(_local(points), frozenset({NEW})) == [1, 2]


def test_a_passage_of_no_edition_is_ranked_as_before():
    """An office's own document or a legacy chunk carries no edition: it neither gains nor loses."""
    points = {1: ([1.0, 0.0], {}), 2: ([1.0, 0.05], {KNOWLEDGE_EDITION_FIELD: OLD})}
    assert _ranked(_local(points), frozenset({NEW})) == [1, 2]


@pytest.mark.parametrize("binding", [OLD, NEW])
def test_both_ranked_reads_put_the_binding_editions_passage_first_on_qdrant(qdrant_store, binding):
    write(CORPUS, [record(TEXT, "rl4-2019.pdf")], {"country_id": "XA", KNOWLEDGE_EDITION_FIELD: OLD})
    write(CORPUS, [record(TEXT, "rl4-2023.pdf")], {"country_id": "XA", KNOWLEDGE_EDITION_FIELD: NEW})
    _bind(binding)

    hits = hybrid_search(qdrant_store, [CORPUS], office_id=None, vector=vector(TEXT), lexical_text=TEXT, limit=10)
    grouped = grouped_search(
        qdrant_store,
        [CORPUS],
        office_id=None,
        vector=vector(TEXT),
        lexical_text=TEXT,
        group_by="scope",
        groups=1,
        group_size=10,
    )

    assert [hit.payload[KNOWLEDGE_EDITION_FIELD] for hit in hits] == [binding, ({OLD, NEW} - {binding}).pop()]
    assert [hit.payload[KNOWLEDGE_EDITION_FIELD] for hit in grouped[0][1]][0] == binding
