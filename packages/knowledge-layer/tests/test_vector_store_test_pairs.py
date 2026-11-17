from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.vector_store import make_client
from knowledge_layer_testing import vector_store as qdrant_testing

schema = qdrant_testing.schema


def _a_test_of(module: str) -> SimpleNamespace:
    return SimpleNamespace(module=SimpleNamespace(__name__=module))


def _finish(fixture) -> None:
    with pytest.raises(StopIteration):
        next(fixture)


def test_a_module_s_pair_is_deleted_once_a_test_of_another_module_asks_for_a_store(monkeypatch):
    qdrant_testing.server_url()
    monkeypatch.setattr(schema, "INDEXED_FIELDS", frozenset())
    first = qdrant_testing.shared_store(monkeypatch, _a_test_of("tests.test_first"))
    next(first)
    client = make_client()
    office = schema.ALIASES[schema.Physical.OFFICE] + schema.FIRST_VERSION
    client.create_collection(office, vectors_config={})
    _finish(first)
    assert client.collection_exists(office), "the pair outlives its test, for the next test of its module"

    second = qdrant_testing.shared_store(monkeypatch, _a_test_of("tests.test_second"))
    next(second)
    try:
        assert not client.collection_exists(office)
    finally:
        _finish(second)
