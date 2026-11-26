from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import QdrantStore
from knowledge_layer.vector_store import copy_facts
from knowledge_layer.vector_store import facts_by_file
from knowledge_layer.vector_store import name_scope
from knowledge_layer.vector_store import rewrite_file_name
from knowledge_layer.vector_store import write_chunks
from knowledge_layer_testing.vector_store import IDENTITY
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write
from qdrant_client import models

pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect:UserWarning")

SCOPE = "proj_same_names"
PLAN = "Plan.pdf"


def _seed(local_qdrant_store) -> None:
    write(
        SCOPE,
        [record("Erdgeschoss", PLAN, chunk_id="a1"), record("EG Detail", PLAN, chunk_id="a2")],
        {"document_id": "doc-a"},
    )
    write(SCOPE, [record("Obergeschoss", PLAN, chunk_id="b1")], {"document_id": "doc-b"})
    write(SCOPE, [record("Alte Fassung", PLAN, chunk_id="legacy-1")])


def _payloads(store: QdrantStore) -> dict[str, dict]:
    return {str(point.payload["chunk_id"]): dict(point.payload) for point in store.scroll(SCOPE)}


def _document(file_name: str, document_id: str | None, folder_path: str | None) -> SimpleNamespace:
    return SimpleNamespace(
        file_name=file_name,
        document_id=document_id,
        tags=[],
        topics=[],
        superseded_by=None,
        doc_class=None,
        folder_path=folder_path,
    )


@pytest.fixture
def two_plans(monkeypatch):
    from agent import knowledge

    documents = [_document(PLAN, "doc-a", "Einreichung"), _document(PLAN, "doc-b", "Ausführung/OG")]
    asked: list[tuple[list[str], list[str] | None]] = []

    def get_documents(collection, filenames, *, document_ids=None):
        asked.append((list(filenames), document_ids))
        wanted = set(document_ids or ())
        return [doc for doc in documents if doc.document_id in wanted or doc.file_name in filenames]

    monkeypatch.setattr(knowledge, "get_documents", get_documents)
    monkeypatch.setattr(knowledge, "get_available_documents", lambda collection: list(documents))
    return asked


class TestTheFilterThatAddressesADocument:
    def test_an_id_selects_the_points_that_carry_it(self):
        selector = QdrantStore._document_filter(SCOPE, "doc-a", "document_id")
        conditions = [condition for condition in selector.must if isinstance(condition, models.FieldCondition)]
        assert any(c.key == DOCUMENT_ID_FIELD and c.match == models.MatchValue(value="doc-a") for c in conditions)
        assert not any(c.key == "file_name" for c in conditions)

    def test_a_name_selects_the_points_of_that_name(self):
        selector = QdrantStore._document_filter(SCOPE, PLAN, "file_name")
        assert models.FieldCondition(key="file_name", match=models.MatchValue(value=PLAN)) in selector.must

    def test_any_other_key_is_refused(self):
        with pytest.raises(ValueError):
            QdrantStore._document_filter(SCOPE, PLAN, "chunk_id")  # type: ignore[arg-type]


class TestPayloadsByDocument:
    def test_payloads_by_id_land_on_that_documents_points_only(self, local_qdrant_store):
        _seed(local_qdrant_store)

        local_qdrant_store.set_file_payloads(SCOPE, {"doc-a": {"folder_path": "Einreichung"}}, key="document_id")

        payloads = _payloads(local_qdrant_store)
        assert {cid for cid, p in payloads.items() if p.get("folder_path") == "Einreichung"} == {"a1", "a2"}

    def test_payloads_by_name_reach_the_points_without_an_id(self, local_qdrant_store):
        _seed(local_qdrant_store)

        local_qdrant_store.set_file_payloads(SCOPE, {PLAN: {"folder_path": "Alt"}})

        assert _payloads(local_qdrant_store)["legacy-1"]["folder_path"] == "Alt"

    def test_while_names_still_reach_identified_points_a_row_without_an_id_keeps_its_facts(
        self, local_qdrant_store, monkeypatch
    ):
        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)
        write(SCOPE, [record("EG", PLAN, chunk_id="a1")], {"document_id": "doc-a"})

        local_qdrant_store.set_file_payloads(SCOPE, {PLAN: {"folder_path": "Einreichung"}})

        assert _payloads(local_qdrant_store)["a1"]["folder_path"] == "Einreichung"

    def test_a_rename_by_id_rewrites_only_that_documents_name(self, local_qdrant_store):
        _seed(local_qdrant_store)

        assert rewrite_file_name(SCOPE, "doc-b", "Plan 2.pdf") == 1

        names = {cid: p["file_name"] for cid, p in _payloads(local_qdrant_store).items()}
        assert names == {"a1": PLAN, "a2": PLAN, "b1": "Plan 2.pdf", "legacy-1": PLAN}

    def test_a_rename_of_a_document_without_points_writes_nothing(self, local_qdrant_store):
        _seed(local_qdrant_store)
        assert rewrite_file_name(SCOPE, "doc-unknown", "Plan 3.pdf") == 0
        assert {p["file_name"] for p in _payloads(local_qdrant_store).values()} == {PLAN}

    def test_the_chunks_own_class_is_restored_for_that_document_only(self, local_qdrant_store):
        write(SCOPE, [record("EG", PLAN, chunk_id="a1", doc_class="plan")], {"document_id": "doc-a"})
        write(SCOPE, [record("OG", PLAN, chunk_id="b1", doc_class="plan")], {"document_id": "doc-b"})
        local_qdrant_store.set_file_payloads(SCOPE, {"doc-a": {"doc_class": "bescheid"}}, key="document_id")
        local_qdrant_store.set_file_payloads(SCOPE, {"doc-b": {"doc_class": "bescheid"}}, key="document_id")

        local_qdrant_store.restore_chunk_doc_classes(SCOPE, ["doc-a"], key="document_id")

        classes = {cid: p.get("doc_class") for cid, p in _payloads(local_qdrant_store).items()}
        assert classes["b1"] == "bescheid"
        assert classes["a1"] != "bescheid"


class TestFactsOfTwoDocumentsThatShareAName:
    def test_the_facts_are_keyed_by_id(self, two_plans):
        facts = facts_by_file(SCOPE, document_ids=["doc-a", "doc-b"])
        assert set(facts) == {"doc-a", "doc-b"}
        assert facts["doc-a"]["folder_ancestors"] == ["einreichung"]
        assert facts["doc-b"]["folder_ancestors"] == ["ausführung", "ausführung/og"]

    def test_each_document_gets_its_own_folder_ancestors(self, local_qdrant_store, two_plans):
        _seed(local_qdrant_store)

        assert copy_facts(SCOPE, document_ids=["doc-a", "doc-b"]) == 2

        ancestors = {cid: p.get("folder_ancestors") for cid, p in _payloads(local_qdrant_store).items()}
        assert ancestors["a1"] == ancestors["a2"] == ["einreichung"]
        assert ancestors["b1"] == ["ausführung", "ausführung/og"]
        assert not ancestors["legacy-1"]
        assert two_plans == [([], ["doc-a", "doc-b"])]

    def test_the_old_positional_call_still_copies_by_name(self, local_qdrant_store, monkeypatch):
        from agent import knowledge

        monkeypatch.setattr(knowledge, "get_documents", lambda collection, filenames: [_document(PLAN, None, "Archiv")])
        _seed(local_qdrant_store)

        assert copy_facts(SCOPE, [PLAN]) == 1

        assert _payloads(local_qdrant_store)["legacy-1"]["folder_path"] == "Archiv"

    def test_a_write_takes_the_facts_of_its_own_document(self, local_qdrant_store, two_plans):
        records = [record("OG neu", PLAN, chunk_id="b2")]

        write_chunks(SCOPE, PLAN, records, identity=IDENTITY, config={"document_id": "doc-b"})

        assert _payloads(local_qdrant_store)["b2"]["folder_path"] == "Ausführung/OG"
        assert two_plans == [([], ["doc-b"])]

    def test_while_names_still_reach_identified_points_a_write_takes_the_facts_of_a_row_without_an_id(
        self, local_qdrant_store, monkeypatch
    ):
        from agent import knowledge

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)
        legacy_row = _document(PLAN, None, "Einreichung")
        monkeypatch.setattr(
            knowledge,
            "get_documents",
            lambda collection, filenames, *, document_ids=None: [] if document_ids else [legacy_row],
        )

        write_chunks(
            SCOPE, PLAN, [record("EG", PLAN, chunk_id="a3")], identity=IDENTITY, config={"document_id": "doc-a"}
        )

        assert _payloads(local_qdrant_store)["a3"]["folder_path"] == "Einreichung"


def _similar_point(chunk_id: str, document_id: str | None) -> SimpleNamespace:
    payload = {"scope": SCOPE, "file_name": PLAN, "chunk_id": chunk_id, "text": chunk_id}
    return SimpleNamespace(
        id=chunk_id, score=0.9, payload={**payload, **({"document_id": document_id} if document_id else {})}
    )


class TestSimilarPassagesOfNamesakes:
    def test_two_namesakes_are_two_similar_documents(self):
        from knowledge_layer.vector_store import similar

        found = similar.group_by_document(
            [_similar_point("a1", "doc-a"), _similar_point("b1", "doc-b"), _similar_point("l1", None)], 5, 3
        )

        assert [(document.file_name, document.document_id) for document in found] == [
            (PLAN, "doc-a"),
            (PLAN, "doc-b"),
            (PLAN, None),
        ]

    def test_the_source_document_is_left_out_by_its_id(self):
        from knowledge_layer.vector_store import similar

        excluded = similar._excluded(similar.PassageSource(SCOPE, PLAN, document_id="doc-a"))

        by_id = models.FieldCondition(key=DOCUMENT_ID_FIELD, match=models.MatchValue(value="doc-a"))
        assert any(by_id in exclusion.must for exclusion in excluded.must_not)
