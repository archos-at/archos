"""A test module's shared Qdrant pair lives only while that module's tests run.

An empty collection is not small: every payload index writes two 1 MiB
null-flag files per segment, about 300 MiB a collection with the schema's
indexes, and CI's Qdrant keeps its storage on a tmpfs of half the runner's
memory. Pairs kept until the process exited filled it at 27 collections, and
every later write failed with ``No space left on device: WAL buffer size exceeds
available disk space`` (2026-11-12). So a process holds one module's pair at a
time, and this holds it there. Against ``QDRANT_TEST_URL``, like every store test.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.vector_store import make_client
from knowledge_layer_testing import vector_store as qdrant_testing

#: The schema module the fixture reads its aliases and indexes from.
schema = qdrant_testing.schema


def _a_test_of(module: str) -> SimpleNamespace:
    """The part of a pytest request ``shared_store`` reads: the test's module."""
    return SimpleNamespace(module=SimpleNamespace(__name__=module))


def _finish(fixture) -> None:
    """Run a fixture's teardown: the test that asked for it is over."""
    with pytest.raises(StopIteration):
        next(fixture)


def test_a_module_s_pair_is_deleted_once_a_test_of_another_module_asks_for_a_store(monkeypatch):
    qdrant_testing.server_url()
    # Without payload indexes the pair is cheap to make, and a pair without them is one the fixture keeps.
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
