"""Every search over an office's scopes carries the office it reads as (``scope.ScopeRead``).

The scope list is the boundary the BFF signs; the office condition is the
second one, under it: a scope name that reached the list by mistake (another
office's ``proj_``, or one project scope two offices' points share) still
returns nothing of the other office. Each leak test runs twice, once with the
condition dropped, to prove the leak it guards against is real and that the
condition, not the fixture, is what stops it.

The filter's semantics are checked on Qdrant's local mode, which needs no
server; the search paths themselves (ranked, grouped, similar, literal) on the
real server behind ``qdrant_store``, which skips without ``QDRANT_TEST_URL``.
"""

from __future__ import annotations

import pytest
from knowledge_layer.search import office_for
from knowledge_layer.search import reading_as
from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
from knowledge_layer.vector_store import LICENCE_CLASS_FIELD
from knowledge_layer.vector_store import OFFICE_FIELD
from knowledge_layer.vector_store import PassageSource
from knowledge_layer.vector_store import ScopeRead
from knowledge_layer.vector_store import candidate_counts
from knowledge_layer.vector_store import enrichment
from knowledge_layer.vector_store import find_similar
from knowledge_layer.vector_store import find_text
from knowledge_layer.vector_store import grouped_search
from knowledge_layer.vector_store import hybrid_search
from knowledge_layer.vector_store import office_condition
from knowledge_layer.vector_store import scope_filter
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import vector
from knowledge_layer_testing.vector_store import write
from qdrant_client import QdrantClient
from qdrant_client import models

from agent import project_context

OFFICE_A = "org_a"
OFFICE_B = "org_b"
PROJECT = "proj_shared"
OTHER_PROJECT = "proj_of_b"
CORPUS = "oib_knowledge"
TEXT = "Fluchtweg Breite Stiegenhaus"

#: The office condition in place, and dropped: the second run must leak, or the first proves nothing.
WITH_AND_WITHOUT = pytest.mark.parametrize("dropped", [False, True], ids=["office-filtered", "condition-dropped"])


def _drop_condition(monkeypatch, dropped: bool) -> None:
    if dropped:
        monkeypatch.setattr(ScopeRead, "office", lambda read: [])


# ---------------------------------------------------------------- building a read


class TestBuildingARead:
    def test_a_tenant_read_without_an_office_raises(self):
        for scopes in ([PROJECT], ["s_upload"], ["office_shelf_org_a"], [CORPUS, PROJECT]):
            with pytest.raises(ValueError, match="needs the office"):
                ScopeRead(tuple(scopes), None)

    def test_a_blank_office_is_no_office(self):
        with pytest.raises(ValueError):
            ScopeRead((PROJECT,), "  ")

    def test_a_corpus_read_needs_no_office(self):
        read = ScopeRead((CORPUS,), None)

        assert read.office_id is None
        assert office_condition(read) is None
        assert read.filter() == scope_filter([CORPUS])

    def test_the_condition_names_only_the_reads_tenant_scopes(self):
        condition = office_condition(ScopeRead((CORPUS, PROJECT, PROJECT), OFFICE_A))

        assert condition is not None
        outside, same_office, no_office = condition.should
        assert outside.must_not[0].match.any == [PROJECT]
        assert same_office.match.value == OFFICE_A
        assert no_office.is_empty.key == OFFICE_FIELD


# ---------------------------------------------------------------- the filter's semantics (local mode)


@pytest.fixture
def local():
    """Qdrant's local mode with one point per case: office A's, office B's, a legacy point, a corpus point."""
    client = QdrantClient(":memory:")
    client.create_collection(
        "t", vectors_config={"dense": models.VectorParams(size=2, distance=models.Distance.COSINE)}
    )
    payloads = {
        1: {"scope": PROJECT, "office_id": OFFICE_A},
        2: {"scope": PROJECT, "office_id": OFFICE_B},
        3: {"scope": PROJECT},
        4: {"scope": PROJECT, "office_id": None},
        # The corpus carries the platform organization's office: never office A's, and still read.
        5: {"scope": CORPUS, "office_id": "org_platform"},
        6: {"scope": OTHER_PROJECT, "office_id": OFFICE_B},
    }
    client.upsert("t", [models.PointStruct(id=i, vector={"dense": [1.0, 0.0]}, payload=p) for i, p in payloads.items()])
    return client


def _found(client: QdrantClient, read: ScopeRead) -> set[int]:
    result = client.query_points("t", query=[1.0, 0.0], using="dense", query_filter=read.filter(), limit=50)
    return {int(point.id) for point in result.points}


@WITH_AND_WITHOUT
def test_office_a_never_reads_office_bs_point_in_a_shared_scope(local, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    found = _found(local, ScopeRead((PROJECT, CORPUS), OFFICE_A))

    assert {1, 3, 4, 5} <= found
    assert (2 in found) is dropped


@WITH_AND_WITHOUT
def test_another_offices_project_named_in_the_scope_list_stays_empty(local, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    found = _found(local, ScopeRead((PROJECT, OTHER_PROJECT), OFFICE_A))

    assert (6 in found) is dropped


def test_a_legacy_point_with_no_office_is_still_found_in_its_scope(local):
    assert {3, 4} <= _found(local, ScopeRead((PROJECT,), OFFICE_A))


def test_a_corpus_read_with_no_office_reads_the_corpus(local):
    assert _found(local, ScopeRead((CORPUS,), None)) == {5}


# ---------------------------------------------------------------- the search paths (a real Qdrant)


@pytest.fixture
def two_offices(qdrant_store):
    """One project scope holding a file of office A, one of office B and one written before ``office_id`` existed."""
    write(PROJECT, [record(TEXT, "A.pdf")], {"organization_id": OFFICE_A})
    write(PROJECT, [record(TEXT, "B.pdf")], {"organization_id": OFFICE_B})
    write(PROJECT, [record(TEXT, "Legacy.pdf")])
    return qdrant_store


def _files(hits) -> set[str]:
    return {hit.payload["file_name"] for hit in hits}


@WITH_AND_WITHOUT
def test_the_ranked_search_reads_as_its_office(two_offices, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    hits = hybrid_search(two_offices, [PROJECT], office_id=OFFICE_A, vector=vector(TEXT), lexical_text=TEXT, limit=10)

    assert {"A.pdf", "Legacy.pdf"} <= _files(hits)
    assert ("B.pdf" in _files(hits)) is dropped


@WITH_AND_WITHOUT
def test_the_grouped_search_reads_as_its_office(two_offices, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    groups = grouped_search(
        two_offices,
        [PROJECT],
        office_id=OFFICE_A,
        vector=vector(TEXT),
        lexical_text=TEXT,
        group_by="scope",
        groups=5,
        group_size=10,
    )

    files = {name for _, hits in groups for name in _files(hits)}
    assert ("B.pdf" in files) is dropped and "A.pdf" in files


@WITH_AND_WITHOUT
def test_similar_passages_read_as_their_office(two_offices, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    result = find_similar(
        two_offices,
        [PROJECT],
        office_id=OFFICE_A,
        source=PassageSource(scope=PROJECT, file_name="Legacy.pdf", text=TEXT),
        embed=vector,
        documents=5,
        per_document=1,
    )

    files = {document.file_name for document in result.documents}
    assert ("B.pdf" in files) is dropped and "A.pdf" in files


@WITH_AND_WITHOUT
def test_the_literal_search_reads_as_its_office(two_offices, monkeypatch, dropped):
    _drop_condition(monkeypatch, dropped)

    hits = find_text(PROJECT, r"(?i)fluchtweg", None, 50, office_id=OFFICE_A)

    assert {"A.pdf", "Legacy.pdf"} <= _files(hits)
    assert ("B.pdf" in _files(hits)) is dropped


def test_every_search_refuses_a_tenant_read_without_an_office(two_offices):
    with pytest.raises(ValueError):
        hybrid_search(two_offices, [PROJECT], office_id=None, vector=vector(TEXT), lexical_text=TEXT, limit=3)
    with pytest.raises(ValueError):
        find_text(PROJECT, "x", None, 5, office_id=None)
    with pytest.raises(ValueError):
        candidate_counts(PROJECT, "Fluchtweg", None, office_id=None)


def test_a_corpus_search_with_no_office_works(qdrant_store):
    write(CORPUS, [record(TEXT, "OIB.pdf")], {"organization_id": "org_platform"})

    hits = hybrid_search(qdrant_store, [CORPUS], office_id=None, vector=vector(TEXT), lexical_text=TEXT, limit=3)

    assert _files(hits) == {"OIB.pdf"}


# ---------------------------------------------------------------- the office the retriever reads as


class TestTheRetrieversOffice:
    @pytest.fixture(autouse=True)
    def no_request(self, monkeypatch):
        monkeypatch.setattr(project_context, "get_organization_id_from_context", lambda: None)

    def test_a_named_office_comes_first(self, monkeypatch):
        monkeypatch.setattr(project_context, "get_organization_id_from_context", lambda: OFFICE_B)

        with reading_as(OFFICE_A):
            assert office_for([PROJECT]) == OFFICE_A
        assert office_for([PROJECT]) == OFFICE_B

    def test_an_office_shelf_names_its_own_office(self):
        assert office_for(["office_shelf_org_a", "archiv_org_a"]) == OFFICE_A

    def test_nothing_names_the_office_of_a_project(self):
        assert office_for([PROJECT]) is None
        assert office_for(["office_shelf_org_a", PROJECT]) is None
        assert office_for(["office_shelf_org_a", "office_shelf_org_b"]) is None


# ---------------------------------------------------------------- the licence mark


class TestTheLicenceMark:
    def test_an_ingest_job_naming_the_mark_writes_it(self):
        config = {"organization_id": OFFICE_A, "licence_class": "licensed", "knowledge_edition_id": "ed-2026"}

        base = enrichment(PROJECT, config)

        assert base[LICENCE_CLASS_FIELD] == "licensed"
        assert base[KNOWLEDGE_EDITION_FIELD] == "ed-2026"

    def test_the_seams_attestation_and_quote_cap_ride_along(self):
        config = {"licence_class": "licensed", "ai_processing_attested": False, "quote_max_chars": 400}

        base = enrichment(PROJECT, config)

        assert base["ai_processing_attested"] is False and base["quote_max_chars"] == 400

    def test_a_cap_that_is_no_positive_count_is_left_out(self):
        for cap in (0, -5, "400", True):
            assert "quote_max_chars" not in enrichment(PROJECT, {"quote_max_chars": cap})

    def test_a_job_naming_no_mark_writes_none(self):
        base = enrichment(PROJECT, {"organization_id": OFFICE_A})

        assert LICENCE_CLASS_FIELD not in base and KNOWLEDGE_EDITION_FIELD not in base

    def test_an_unknown_licence_class_is_left_out(self):
        assert LICENCE_CLASS_FIELD not in enrichment(PROJECT, {"licence_class": "free_for_all"})

    def test_a_marked_file_is_found_by_its_mark(self, qdrant_store):
        write(PROJECT, [record(TEXT, "A.pdf"), record("Andere Seite", "Other.pdf")], {"organization_id": OFFICE_A})

        qdrant_store.set_file_payloads(
            PROJECT, {"A.pdf": {LICENCE_CLASS_FIELD: "public_open", KNOWLEDGE_EDITION_FIELD: "ed-1"}}
        )

        assert qdrant_store.count(PROJECT, {LICENCE_CLASS_FIELD: "public_open"}) == 1
        assert qdrant_store.count(PROJECT, {KNOWLEDGE_EDITION_FIELD: "ed-1"}) == 1
