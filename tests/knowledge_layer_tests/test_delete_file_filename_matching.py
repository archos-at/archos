from __future__ import annotations

import threading

from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import adapter as adapter_mod
from knowledge_layer_testing.vector_store import chunk_texts
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

import agent.knowledge as knowledge_pkg


class _Collection:
    def __init__(self, chunks: dict[str, dict]):
        write(SCOPE, [record(f"Text {cid}", meta["file_name"], chunk_id=cid) for cid, meta in chunks.items()])

    @property
    def _chunks(self) -> dict[str, str]:
        return chunk_texts(SCOPE)


SCOPE = "proj_test"


def _ingestor(collection: _Collection) -> LlamaIndexIngestor:
    ing = object.__new__(LlamaIndexIngestor)
    ing._lock = threading.RLock()
    return ing


def _patch_side_effects(monkeypatch):
    monkeypatch.setattr(adapter_mod, "bump_collection_version", lambda *_: None)
    monkeypatch.setattr(knowledge_pkg, "unregister_summary", lambda *_, **__: None, raising=False)


def test_delete_matches_percent_encoded_stored_name(monkeypatch, qdrant_store):
    _patch_side_effects(monkeypatch)
    collection = _Collection(
        {
            "c1": {"file_name": "Z%C3%BCrich%20Plan.pdf"},
            "c2": {"file_name": "Z%C3%BCrich%20Plan.pdf"},
            "other": {"file_name": "unrelated.pdf"},
        }
    )
    ing = _ingestor(collection)

    assert ing.delete_file("Zürich Plan.pdf", "proj_test") is True
    assert set(collection._chunks) == {"other"}


def test_delete_matches_tmp_prefixed_encoded_name(monkeypatch, qdrant_store):
    _patch_side_effects(monkeypatch)
    collection = _Collection({"c1": {"file_name": "tmp12345678_Fire%20Safety.pdf"}})
    ing = _ingestor(collection)

    assert ing.delete_file("Fire Safety.pdf", "proj_test") is True
    assert collection._chunks == {}


def test_delete_exact_match_still_works(monkeypatch, qdrant_store):
    _patch_side_effects(monkeypatch)
    collection = _Collection({"c1": {"file_name": "plan.pdf"}})
    ing = _ingestor(collection)

    assert ing.delete_file("plan.pdf", "proj_test") is True
    assert collection._chunks == {}


def test_delete_returns_false_when_no_chunks_match_but_still_forgets_the_file(monkeypatch, qdrant_store):
    monkeypatch.setattr(adapter_mod, "bump_collection_version", lambda *_: None)
    forgotten: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(
        knowledge_pkg,
        "unregister_summary",
        lambda c, f, permanent=False: forgotten.append((c, f, permanent)),
        raising=False,
    )
    collection = _Collection({"c1": {"file_name": "something-else.pdf"}})
    ing = _ingestor(collection)

    assert ing.delete_file("missing.pdf", "proj_test") is False
    assert set(collection._chunks) == {"c1"}
    assert forgotten == [("proj_test", "missing.pdf", False)]


def test_a_permanent_delete_tells_the_store_so(monkeypatch, qdrant_store):
    monkeypatch.setattr(adapter_mod, "bump_collection_version", lambda *_: None)
    forgotten: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        knowledge_pkg,
        "unregister_summary",
        lambda _c, f, permanent=False: forgotten.append((f, permanent)),
        raising=False,
    )
    ing = _ingestor(_Collection({"c1": {"file_name": "plan.pdf"}}))

    assert ing.delete_file("plan.pdf", "proj_test", permanent=True) is True
    ing.delete_file("missing.pdf", "proj_test", permanent=True)
    assert forgotten == [("plan.pdf", True), ("missing.pdf", True)]
