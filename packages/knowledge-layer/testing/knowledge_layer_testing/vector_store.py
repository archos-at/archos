from __future__ import annotations

import atexit
import os
import random
import uuid
from collections.abc import Iterator
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

import pytest
from knowledge_layer.vector_store import ChunkRecord
from knowledge_layer.vector_store import schema
from knowledge_layer.vector_store import store as store_module
from knowledge_layer.vector_store import writes
from qdrant_client import models

DIM = 8
IDENTITY = {"embed_fingerprint": "test-fp", "embed_model": "test-model"}


def server_url() -> str:
    url = os.environ.get("QDRANT_TEST_URL", "").strip()
    if url:
        return url
    if os.environ.get("CI"):
        pytest.fail("QDRANT_TEST_URL is unset on CI: the Qdrant service container is missing")
    pytest.skip("QDRANT_TEST_URL not set; start a Qdrant 1.19 server to run these")


def vector(seed: str) -> list[float]:
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(DIM)]


class FakeEmbedder:

    def __init__(self) -> None:
        self.batches: list[list[str]] = []

    def get_text_embedding_batch(self, texts: Sequence[str], **_kwargs: Any) -> list[list[float]]:
        self.batches.append(list(texts))
        return [vector(text) for text in texts]

    def get_query_embedding(self, query: str) -> list[float]:
        return vector(query)


def record(text: str, file_name: str, *, chunk_id: str | None = None, **metadata: Any) -> ChunkRecord:
    return ChunkRecord(
        chunk_id=chunk_id or str(uuid.uuid4()),
        text=text,
        embedding=vector(text),
        metadata={"file_name": file_name, "page_label": "1", **metadata},
    )


def write(scope: str, records: Sequence[ChunkRecord], config: Mapping[str, Any] | None = None) -> int:
    return store_module.get_store(IDENTITY).upsert(scope, records, writes.enrichment(scope, config))


def chunk_texts(scope: str, filters: dict[str, Any] | None = None) -> dict[str, str]:
    return {
        str((point.payload or {}).get(schema.CHUNK_ID_FIELD)): str((point.payload or {}).get(schema.TEXT_FIELD))
        for point in store_module.get_store().scroll(scope, filters)
    }


_SHARED_SUFFIXES: dict[str, str] = {}
_SIGNATURES: dict[str, Any] = {}


def _point_at(monkeypatch, suffix: str) -> store_module.QdrantStore:
    url = server_url()
    monkeypatch.setitem(schema.ALIASES, schema.Physical.CORPUS, f"test_corpus_{suffix}")
    monkeypatch.setitem(schema.ALIASES, schema.Physical.OFFICE, f"test_office_{suffix}")
    monkeypatch.setenv("QDRANT_URL", url)
    monkeypatch.delenv("QDRANT_API_KEY", raising=False)
    store_module.reset_store()
    return store_module.get_store(IDENTITY)


def _collections() -> list[str]:
    return [schema.ALIASES[physical] + schema.FIRST_VERSION for physical in schema.Physical]


def _delete_pair(client: Any, suffix: str) -> None:
    prefixes = (f"test_corpus_{suffix}_v", f"test_office_{suffix}_v")
    for collection in client.get_collections().collections:
        if collection.name.startswith(prefixes):
            client.delete_collection(collection.name)
            _SIGNATURES.pop(collection.name, None)


def _release_other_modules(module: str) -> None:
    others = [name for name in _SHARED_SUFFIXES if name != module]
    if not others:
        return
    client = store_module.make_client()
    for name in others:
        _delete_pair(client, _SHARED_SUFFIXES.pop(name))


def _delete_shared_collections() -> None:
    if not os.environ.get("QDRANT_TEST_URL", "").strip():
        return
    try:
        from qdrant_client import QdrantClient

        client = QdrantClient(url=os.environ["QDRANT_TEST_URL"], check_compatibility=False)
        for suffix in _SHARED_SUFFIXES.values():
            _delete_pair(client, suffix)
    except Exception:  # noqa: BLE001 - a cleanup at exit must not fail the run
        pass


atexit.register(_delete_shared_collections)


def _signature(client: Any, name: str) -> Any:
    if not client.collection_exists(name):
        return None
    info = client.get_collection(name)
    indexes = {field: (index.data_type, index.params) for field, index in (info.payload_schema or {}).items()}
    return (info.config.model_dump(), indexes)


def shared_store(monkeypatch, request) -> Iterator[store_module.QdrantStore]:
    module = request.module.__name__
    suffix = _SHARED_SUFFIXES.setdefault(module, uuid.uuid4().hex[:10])
    store = _point_at(monkeypatch, suffix)
    _release_other_modules(module)
    client = store_module.make_client()
    names = _collections()
    wanted_indexes = set(schema.INDEXED_FIELDS)
    try:
        yield store
    finally:
        aliases = {alias.alias_name: alias.collection_name for alias in client.get_aliases().aliases}
        moved = any(aliases.get(name.removesuffix(schema.FIRST_VERSION)) not in (None, name) for name in names)
        for name in names:
            before, after = _SIGNATURES.get(name), _signature(client, name)
            if after is None:
                _SIGNATURES.pop(name, None)
                continue
            reshaped = set(after[1]) != wanted_indexes if before is None else before != after
            if moved or reshaped:
                client.delete_collection(name)
                _SIGNATURES.pop(name, None)
            else:
                client.delete(name, points_selector=models.FilterSelector(filter=models.Filter()), wait=True)
                _SIGNATURES[name] = after
        store_module.reset_store()


def fresh_store(monkeypatch) -> Iterator[store_module.QdrantStore]:
    store = _point_at(monkeypatch, uuid.uuid4().hex[:10])
    try:
        yield store
    finally:
        client = store_module.make_client()
        for name in _collections():
            if client.collection_exists(name):
                client.delete_collection(name)
        store_module.reset_store()


@pytest.fixture
def qdrant_store(monkeypatch, request) -> Iterator[store_module.QdrantStore]:
    yield from shared_store(monkeypatch, request)


@pytest.fixture
def fresh_qdrant_store(monkeypatch) -> Iterator[store_module.QdrantStore]:
    yield from fresh_store(monkeypatch)


FEW_INDEXES = frozenset({"scope", "kind", "file_name", "chunk_id", schema.OFFICE_FIELD, schema.TEXT_FIELD})


@pytest.fixture
def few_payload_indexes(monkeypatch) -> None:
    monkeypatch.setattr(schema, "INDEXED_FIELDS", FEW_INDEXES)


def capture_indexed_documents(monkeypatch, into: list[list[Any]] | None = None) -> list[list[Any]]:
    from knowledge_layer.ingest import LlamaIndexIngestor

    calls: list[list[Any]] = into if into is not None else []
    calls.clear()
    real = LlamaIndexIngestor._embedded_records

    def recording(self: Any, documents: list[Any], **kwargs: Any) -> list[ChunkRecord]:
        calls.append(list(documents))
        return real(self, documents, **kwargs)

    monkeypatch.setattr(LlamaIndexIngestor, "_embedded_records", recording)
    return calls


TEST_OFFICE = "org_test"


@pytest.fixture
def reads_as_an_office() -> Iterator[None]:
    from knowledge_layer.search import reading_as

    with reading_as(TEST_OFFICE):
        yield
