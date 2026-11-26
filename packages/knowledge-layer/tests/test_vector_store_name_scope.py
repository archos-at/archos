from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.search import hit_metadata
from knowledge_layer.search import superseded
from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import QdrantStore
from knowledge_layer.vector_store import copy_facts
from knowledge_layer.vector_store import write_chunks
from knowledge_layer_testing.vector_store import IDENTITY
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write
from qdrant_client import models

pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect:UserWarning")

SCOPE = "proj_name_scope"
PLAN = "Plan.pdf"


def _seed() -> None:
    write(SCOPE, [record("EG", PLAN, chunk_id="a1")], {"document_id": "doc-a"})
    write(SCOPE, [record("OG", PLAN, chunk_id="b1")], {"document_id": "doc-b"})
    write(SCOPE, [record("Alte Fassung", PLAN, chunk_id="legacy-1")])


def _payloads(store: QdrantStore) -> dict[str, dict]:
    return {str(point.payload["chunk_id"]): dict(point.payload) for point in store.scroll(SCOPE)}


def _legacy_row(folder_path: str) -> SimpleNamespace:
    return SimpleNamespace(
        file_name=PLAN,
        document_id=None,
        tags=[],
        topics=[],
        superseded_by=None,
        doc_class=None,
        folder_path=folder_path,
    )


def test_a_name_selects_only_points_that_carry_no_id():
    selector = QdrantStore._document_filter(SCOPE, PLAN, "file_name")
    assert models.FieldCondition(key="file_name", match=models.MatchValue(value=PLAN)) in selector.must
    assert models.IsEmptyCondition(is_empty=models.PayloadField(key=DOCUMENT_ID_FIELD)) in selector.must


def test_payloads_by_name_never_reach_a_point_that_carries_an_id(local_qdrant_store):
    _seed()

    local_qdrant_store.set_file_payloads(SCOPE, {PLAN: {"folder_path": "Alt"}})

    payloads = _payloads(local_qdrant_store)
    assert {cid for cid, p in payloads.items() if p.get("folder_path") == "Alt"} == {"legacy-1"}


def test_a_copy_by_name_leaves_the_namesakes_chunks_alone(local_qdrant_store, monkeypatch):
    from agent import knowledge

    monkeypatch.setattr(knowledge, "get_documents", lambda collection, filenames: [_legacy_row("Archiv")])
    _seed()

    copy_facts(SCOPE, [PLAN])

    folders = {cid: p.get("folder_path") for cid, p in _payloads(local_qdrant_store).items()}
    assert folders == {"a1": None, "b1": None, "legacy-1": "Archiv"}


def test_a_write_by_id_never_takes_a_namesakes_facts_by_name(local_qdrant_store, monkeypatch):
    from agent import knowledge

    monkeypatch.setattr(
        knowledge,
        "get_documents",
        lambda collection, filenames, *, document_ids=None: [] if document_ids else [_legacy_row("Fremd")],
    )

    write_chunks(SCOPE, PLAN, [record("EG", PLAN, chunk_id="a2")], identity=IDENTITY, config={"document_id": "doc-a"})

    assert _payloads(local_qdrant_store)["a2"].get("folder_path") is None


def _hit(document_id: str | None) -> SimpleNamespace:
    metadata = {"collection": SCOPE, **({"document_id": document_id} if document_id else {})}
    return SimpleNamespace(metadata=metadata, file_name=PLAN, content=document_id or "legacy")


def test_a_hit_with_an_id_never_takes_a_namesakes_facts_by_name(monkeypatch):
    from agent import knowledge

    asked: list = []

    def folder_paths(collection, filenames, *, document_ids=None):
        asked.append((list(filenames), list(document_ids or ())))
        return {PLAN: "Fremd"}

    monkeypatch.setattr(knowledge.factory, "get_document_folder_paths", folder_paths)
    hits = [_hit("doc-a")]

    assert hit_metadata.hit_folder_path(hits[0], hit_metadata.resolve_folder_paths(hits)) is None
    assert asked == [([], ["doc-a"])]


def test_a_namesake_replaced_by_name_does_not_hide_a_hit_with_an_id():
    replaced = superseded.Replaced(by_name={PLAN: "Plan B.pdf"})

    kept = superseded.without_replaced([_hit("doc-a"), _hit(None)], replaced)

    assert [hit.content for hit in kept] == ["doc-a"]


def test_the_source_of_similar_passages_never_leaves_out_a_namesake():
    from knowledge_layer.vector_store import similar

    excluded = similar._excluded(similar.PassageSource(SCOPE, PLAN, document_id="doc-a"))

    by_name = models.FieldCondition(key="file_name", match=models.MatchValue(value=PLAN))
    assert not any(by_name in exclusion.must for exclusion in excluded.must_not)
