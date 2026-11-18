from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

import numpy as np

from oib_retrieval import corpus
from oib_retrieval import qrels
from oib_retrieval.qdrant_parity import evaluation
from oib_retrieval.qdrant_parity.stores import IndexedChunk
from oib_retrieval.qdrant_parity.vectors import Embedder
from oib_retrieval.qdrant_parity.vectors import embed_text

_CHUNK_NAMESPACE = uuid.UUID("0f4e8a52-3c1d-4b8e-9f60-7a2d1c5e9b31")


@dataclass
class Inputs:
    chunks: list[IndexedChunk]
    doc_vectors: np.ndarray
    judgements: list[qrels.Judgements]
    overview: list[Any]
    hard_cases: list[evaluation.HardCase]
    excluded: frozenset[str]
    query_vectors: dict[str, np.ndarray] = field(default_factory=dict)
    embedder: str = "production"
    model: str = ""
    base_url: str = ""
    embedded_now: int = 0


def indexed_chunks(raw: Sequence[corpus.Chunk]) -> list[IndexedChunk]:
    return [
        IndexedChunk(
            chunk_id=str(uuid.uuid5(_CHUNK_NAMESPACE, chunk.chunk_id)),
            text=chunk.text,
            file_name=chunk.file_name,
            page=chunk.page,
            metadata={key: value for key, value in chunk.metadata.items() if value is not None},
        )
        for chunk in raw
    ]


def all_queries(inputs: Inputs) -> list[str]:
    seen: dict[str, None] = {}
    for judged in inputs.judgements:
        seen[judged.entry.question] = None
    for entry in inputs.overview:
        seen[entry.question] = None
    for case in inputs.hard_cases:
        seen[case.query] = None
    return list(seen)


def embed_inputs(inputs: Inputs, embedder: Embedder) -> None:
    texts = [embed_text(chunk.text, chunk.metadata) for chunk in inputs.chunks]
    inputs.doc_vectors = embedder.embed("document", texts)
    queries = all_queries(inputs)
    vectors = embedder.embed("query", queries)
    inputs.query_vectors = {query: vectors[i] for i, query in enumerate(queries)}
    inputs.embedder = embedder.name
    inputs.model = embedder.model
    inputs.base_url = embedder.base_url
    inputs.embedded_now = embedder.embedded_now


def load_inputs(embedder_name: str, cache_dir: Path) -> Inputs:
    from oib_retrieval import overview

    fixtures = corpus.package_root() / "fixtures"
    golden = qrels.load_golden(fixtures / "oib_retrieval_golden.json")
    clause_index = qrels.load_clause_index(fixtures / "clause_index.json")
    excluded = corpus.production_retrieval_settings().exclude_file_names
    inputs = Inputs(
        chunks=indexed_chunks(corpus.build_arm(corpus.ARM_CLAUSE)),
        doc_vectors=np.zeros((0, 0), dtype=np.float32),
        judgements=list(qrels.build_judgements(golden, clause_index)),
        overview=overview.load_golden(overview.default_golden_path()),
        hard_cases=evaluation.load_hard_cases(fixtures / "qdrant_lexical_hard_cases.json"),
        excluded=frozenset(excluded),
    )
    embed_inputs(inputs, Embedder(embedder_name, cache_dir / embedder_name))
    return inputs
