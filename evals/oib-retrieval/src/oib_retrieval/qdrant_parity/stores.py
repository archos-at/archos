from __future__ import annotations

import contextlib
import logging
import os
import time
import uuid
from collections.abc import Iterator
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from unittest import mock

import numpy as np

logger = logging.getLogger(__name__)

SCOPE = "oib_parity"


@dataclass(frozen=True)
class IndexedChunk:
    chunk_id: str
    text: str
    file_name: str
    page: int
    metadata: dict[str, Any]


def identity(model: str, base_url: str) -> dict[str, str]:
    from knowledge_layer.embedding import embed_fingerprint_metadata

    return embed_fingerprint_metadata(model, base_url)


@contextlib.contextmanager
def isolated_qdrant(url: str, api_key: str | None = None) -> Iterator[str]:
    from knowledge_layer.vector_store import ALIASES
    from knowledge_layer.vector_store import FIRST_VERSION
    from knowledge_layer.vector_store import Physical
    from knowledge_layer.vector_store import make_client
    from knowledge_layer.vector_store import reset_store

    suffix = uuid.uuid4().hex[:8]
    saved = dict(ALIASES)
    saved_env = {key: os.environ.get(key) for key in ("QDRANT_URL", "QDRANT_API_KEY")}
    os.environ["QDRANT_URL"] = url
    if api_key:
        os.environ["QDRANT_API_KEY"] = api_key
    for physical in Physical:
        ALIASES[physical] = f"parity_{suffix}_{physical.value}"
    reset_store()
    try:
        yield suffix
    finally:
        client = make_client()
        for physical in Physical:
            with contextlib.suppress(Exception):
                name = ALIASES[physical] + FIRST_VERSION
                if client.collection_exists(name):
                    client.delete_collection(name)
        ALIASES.clear()
        ALIASES.update(saved)
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        reset_store()


@contextlib.contextmanager
def _no_person_facts() -> Iterator[None]:
    from agent import knowledge

    with (
        mock.patch.object(knowledge, "get_documents", lambda scope, file_names: []),
        mock.patch.object(knowledge, "get_available_documents", lambda scope: []),
    ):
        yield


def fill_qdrant(chunks: Sequence[IndexedChunk], vectors: np.ndarray, fingerprint: dict[str, str]) -> int:
    from knowledge_layer.vector_store import ChunkRecord
    from knowledge_layer.vector_store import get_store
    from knowledge_layer.vector_store import write_chunks

    by_file: dict[str, list[ChunkRecord]] = {}
    for chunk, vector in zip(chunks, vectors, strict=True):
        record = ChunkRecord(chunk.chunk_id, chunk.text, [float(value) for value in vector], dict(chunk.metadata))
        by_file.setdefault(chunk.file_name, []).append(record)
    with _no_person_facts():
        for file_name, records in by_file.items():
            write_chunks(SCOPE, file_name, records, identity=fingerprint)
    stored = set(get_store(fingerprint).chunk_ids(SCOPE))
    expected = {chunk.chunk_id for chunk in chunks}
    if stored != expected:
        raise RuntimeError(
            f"Qdrant holds {len(stored)} points for {len(expected)} chunks: "
            f"{len(expected - stored)} missing, {len(stored - expected)} extra"
        )
    return len(stored)


def wait_until_indexed(timeout_s: float = 600.0) -> dict[str, Any]:
    from knowledge_layer.vector_store import ALIASES
    from knowledge_layer.vector_store import Physical
    from knowledge_layer.vector_store import get_store

    client = get_store().client
    alias = ALIASES[Physical.CORPUS]
    deadline = time.monotonic() + timeout_s
    info = client.get_collection(alias)
    while time.monotonic() < deadline:
        info = client.get_collection(alias)
        status = str(getattr(info.status, "value", info.status))
        optimizer = str(getattr(info, "optimizer_status", "ok"))
        if status == "green" and "ok" in optimizer.lower():
            break
        time.sleep(1.0)
    return {
        "status": str(getattr(info.status, "value", info.status)),
        "points": int(info.points_count or 0),
        "indexed_vectors": int(info.indexed_vectors_count or 0),
        "segments": int(info.segments_count or 0),
    }


def retriever(model: str, base_url: str, queries: Sequence[str], query_vectors: np.ndarray) -> Any:
    from knowledge_layer.search import LlamaIndexRetriever
    from llama_index.core.embeddings import MockEmbedding

    instance = LlamaIndexRetriever({"embed_model": model, "embed_base_url": base_url, "hybrid_search": True})
    instance._embed_model = MockEmbedding(embed_dim=int(query_vectors.shape[1]))
    instance._initialized = True
    for query, vector in zip(queries, query_vectors, strict=True):
        instance._query_embeddings.seed((model, query), [float(value) for value in vector])
    return instance
