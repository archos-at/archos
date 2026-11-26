from __future__ import annotations

import random
import uuid

import pytest
from knowledge_layer.vector_store import BASE_CORPUS_SCOPE
from knowledge_layer.vector_store import SCOPE_FIELD
from knowledge_layer.vector_store import ChunkRecord
from knowledge_layer.vector_store import move_legacy_base_corpus

from agent.common.source_kinds import LEGACY_BASE_CORPUS_COLLECTION

DIM = 8


@pytest.fixture
def store(qdrant_store):
    return qdrant_store


def _record(file_name: str, text: str) -> ChunkRecord:
    rng = random.Random(text)
    return ChunkRecord(
        chunk_id=str(uuid.uuid4()),
        text=text,
        embedding=[rng.uniform(-1, 1) for _ in range(DIM)],
        metadata={"file_name": file_name, "page_label": "1", "country_id": "AT"},
    )


def _scopes(store) -> list[str]:
    points, _ = store.client.scroll(store.alias(BASE_CORPUS_SCOPE), limit=100, with_payload=[SCOPE_FIELD])
    return sorted(point.payload[SCOPE_FIELD] for point in points)


def test_the_base_corpus_reads_points_still_filed_under_the_old_name(store):
    store.upsert(LEGACY_BASE_CORPUS_COLLECTION, [_record("rl-2.pdf", "Fluchtweg 40 m")])

    assert store.count(BASE_CORPUS_SCOPE) == 1


def test_the_move_files_every_old_point_under_base_corpus_and_a_second_run_finds_none(store):
    store.upsert(LEGACY_BASE_CORPUS_COLLECTION, [_record("rl-2.pdf", "Fluchtweg"), _record("rl-4.pdf", "Stufe")])
    store.upsert(BASE_CORPUS_SCOPE, [_record("rl-6.pdf", "U-Wert")])
    store.upsert("proj_a", [_record("plan.pdf", "Grundriss")])

    assert move_legacy_base_corpus(store) == 2
    assert move_legacy_base_corpus(store) == 0

    assert _scopes(store).count(BASE_CORPUS_SCOPE) == 3
    assert LEGACY_BASE_CORPUS_COLLECTION not in _scopes(store)
    assert store.count("proj_a") == 1


def test_a_store_without_a_corpus_moves_nothing(fresh_qdrant_store):
    assert move_legacy_base_corpus(fresh_qdrant_store) == 0
