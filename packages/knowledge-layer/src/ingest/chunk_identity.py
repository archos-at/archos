from __future__ import annotations

import base64
import hashlib
import logging
import uuid
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from knowledge_layer.env import env_int

logger = logging.getLogger(__name__)

CHUNK_ID_NAMESPACE = uuid.UUID("6f3f1c0e-8a7d-5b8e-9a51-3c1d2f7e4b60")

EMBED_CACHE_TTL_SECONDS = env_int("INGEST_EMBED_CACHE_TTL_SECONDS", 30 * 86400, minimum=0)


@dataclass(frozen=True)
class ChunkVersion:

    collection: str
    document: str
    version: str


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_id(version: ChunkVersion, ordinal: int, text: str) -> str:
    name = "\x00".join((version.collection, version.document, version.version, str(ordinal), text_hash(text)))
    return str(uuid.uuid5(CHUNK_ID_NAMESPACE, name))


def file_version(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def chunk_version(collection: str, document: object, path: str) -> ChunkVersion:
    return ChunkVersion(collection, str(document), file_version(path))


def ids_only_in(ids: Iterable[str], other: Iterable[str] | None) -> list[str]:
    keep = set(other or ())
    return [chunk for chunk in ids if chunk not in keep]


def embedding_cache_key(fingerprint: str, text: str) -> str:
    return f"embed:v1:{fingerprint}:{text_hash(text)}"


def _encode(vector: Sequence[float]) -> str:
    return base64.b64encode(np.asarray(vector, dtype=np.float32).tobytes()).decode("ascii")


def _decode(value: object) -> list[float] | None:
    if not isinstance(value, str):
        return None
    try:
        return np.frombuffer(base64.b64decode(value), dtype=np.float32).astype(float).tolist()
    except ValueError:
        return None


def _cached(keys: list[str]) -> list[list[float] | None]:
    from agent.common.cache import get_json

    found: list[list[float] | None] = []
    for key in keys:
        try:
            found.append(_decode(get_json(key)))
        except Exception:  # noqa: BLE001 - a cache that is down costs the hit
            found.append(None)
    return found


def _store(keys: list[str], vectors: list[Sequence[float]]) -> None:
    from agent.common.cache import set_json

    for key, vector in zip(keys, vectors, strict=True):
        try:
            set_json(key, _encode(vector), EMBED_CACHE_TTL_SECONDS)
        except Exception:  # noqa: BLE001 - a refused write costs the next hit
            logger.debug("Embedding cache write failed (swallowed) for %s", key[:40])


def embed_with_cache(
    texts: list[str], embed: Callable[[list[str]], list[Sequence[float]]], *, fingerprint: str
) -> tuple[list[list[float]], int]:
    if not texts:
        return [], 0
    if EMBED_CACHE_TTL_SECONDS <= 0:
        return [[float(v) for v in vector] for vector in embed(texts)], 0
    keys = [embedding_cache_key(fingerprint, text) for text in texts]
    vectors = _cached(keys)
    missing = [index for index, vector in enumerate(vectors) if vector is None]
    if missing:
        fresh = embed([texts[index] for index in missing])
        _store([keys[index] for index in missing], fresh)
        for index, vector in zip(missing, fresh, strict=True):
            vectors[index] = np.asarray(vector, dtype=np.float32).astype(float).tolist()
    return [vector for vector in vectors if vector is not None], len(texts) - len(missing)


def embedded_records(
    documents: list[Any],
    embed_model: Any,
    *,
    fingerprint: str,
    chunk_size: int,
    chunk_overlap: int,
    version: ChunkVersion | None = None,
) -> list[Any]:
    from knowledge_layer.vector_store import ChunkRecord
    from llama_index.core.schema import MetadataMode

    from .adapter import split_documents

    nodes = split_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not nodes:
        return []
    texts = [node.get_content(metadata_mode=MetadataMode.EMBED) for node in nodes]
    vectors, hits = embed_with_cache(
        texts,
        lambda batch: embed_model.get_text_embedding_batch(batch, show_progress=False),
        fingerprint=fingerprint,
    )
    if hits:
        logger.info("Embedding cache: %d of %d chunk(s) served from the cache", hits, len(texts))
    records = []
    for ordinal, (node, vector) in enumerate(zip(nodes, vectors, strict=True)):
        text = node.get_content(metadata_mode=MetadataMode.NONE)
        records.append(
            ChunkRecord(
                chunk_id=chunk_id(version, ordinal, text) if version is not None else node.node_id,
                text=text,
                embedding=vector,
                metadata=dict(node.metadata),
                ordinal=ordinal,
            )
        )
    return records
