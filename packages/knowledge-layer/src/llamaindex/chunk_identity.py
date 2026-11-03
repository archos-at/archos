"""A chunk's id from what it is, and its embedding from what it says.

**Deterministic ids.** A chunk's id was the splitter's random node id, so a
retried write of the same file added a second copy of every chunk beside the
first, and the code that took a failed attempt back out had to remember which
random ids it had sent. The id is now ``uuid5`` of the collection, the
document, the version (the file's content hash), the chunk's ordinal and the
hash of its text: a retry writes the same ids and overwrites, a re-read of the
same bytes into the same chunks lands on the ids it already has, and a new
version's chunks never share an id with the old one's unless they are the same
chunk of the same bytes. Retiring a previous version and discarding a failed
attempt therefore leave out the ids the other side also holds
(:func:`ids_only_in`), and both are idempotent.

**The embedding cache.** One chunk's vector is a function of the embedder and
the text it embeds, so it is cached on the shared cache (Dragonfly, through
``agent.common.cache``) under the embedder's fingerprint
(``embedding.embed_fingerprint``: model and endpoint) and the text's hash, for
:data:`EMBED_CACHE_TTL_SECONDS`. A vector from one embedder is never served to
another, which is the same identity the collection's ``check_identity``
enforces ("embedding mismatch" in the gotchas). Vectors are stored as float32,
the precision Qdrant stores them in, so a cached vector writes the same point
as a fresh one. A cache that is down or refuses costs the hit, never the file.
"""

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

from .env import env_int

logger = logging.getLogger(__name__)

#: Namespace of every chunk id; changing it re-keys every chunk ever written.
CHUNK_ID_NAMESPACE = uuid.UUID("6f3f1c0e-8a7d-5b8e-9a51-3c1d2f7e4b60")

# @environment_variable INGEST_EMBED_CACHE_TTL_SECONDS
# @category Knowledge Layer
# @type int
# @default 2592000
# @required false
# Seconds an ingest's chunk embedding stays on the shared cache, keyed by the
# embedder's fingerprint and the text's hash, so a retried or re-read file does
# not embed the same chunks again. About 12 KiB per chunk at 3072 dimensions.
# Default 30 days, like the vision cache; 0 turns the cache off.
EMBED_CACHE_TTL_SECONDS = env_int("INGEST_EMBED_CACHE_TTL_SECONDS", 30 * 86400, minimum=0)


@dataclass(frozen=True)
class ChunkVersion:
    """What a chunk id is scoped to: the collection, the document and its version."""

    collection: str
    document: str
    version: str


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_id(version: ChunkVersion, ordinal: int, text: str) -> str:
    """The id of chunk ``ordinal`` with ``text`` of this version: the same inputs, the same id."""
    name = "\x00".join((version.collection, version.document, version.version, str(ordinal), text_hash(text)))
    return str(uuid.uuid5(CHUNK_ID_NAMESPACE, name))


def file_version(path: str) -> str:
    """The content hash of the file at ``path``: the version a chunk id names."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def chunk_version(collection: str, document: object, path: str) -> ChunkVersion:
    """The version the chunks of the file at ``path`` are written under: its document (id, else name) and bytes."""
    return ChunkVersion(collection, str(document), file_version(path))


def ids_only_in(ids: Iterable[str], other: Iterable[str] | None) -> list[str]:
    """``ids`` without those ``other`` also holds, in order: what one side may delete without touching the other."""
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
    """A vector per text, from the cache where it has one and from ``embed`` (one batch) for the rest.

    Returns the vectors in input order and how many came from the cache.
    """
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
            # As float32, what the point stores: a cached and a fresh vector write the same point.
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
    """``documents`` split into chunks and embedded: the records the store writes.

    The splitter is a ``SentenceSplitter`` at the job's chunk size and overlap,
    built per job. What is embedded is each chunk's EMBED rendering (its
    metadata header, minus the keys ``stamp_chunk_metadata`` excluded, then its
    text), through the cache; what is stored is the bare text. ``documents``
    are one file's, so a record's ``ordinal`` (its index in the chunker's
    output) is its place in the file, and with ``version`` its id is
    :func:`chunk_id`; without one (a caller outside an ingest) it keeps the
    splitter's node id.
    """
    from llama_index.core.schema import MetadataMode

    from ..qdrant.payload import ChunkRecord
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
