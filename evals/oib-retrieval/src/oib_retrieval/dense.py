from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from oib_retrieval.corpus import Chunk

logger = logging.getLogger(__name__)

E5_MODEL_ID = "intfloat/multilingual-e5-small"

MODEL_CACHE_ENV = "OIB_RETRIEVAL_MODEL_CACHE"

HASHED_DIMENSION = 512


class Embedder(Protocol):
    name: str

    def encode_documents(self, texts: list[str]) -> np.ndarray: ...

    def encode_queries(self, texts: list[str]) -> np.ndarray: ...


def _normalise_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return matrix / norms


class HashedEmbedder:
    name = "hashed"

    def __init__(self, dimension: int = HASHED_DIMENSION) -> None:
        self.dimension = dimension

    def _encode(self, texts: list[str]) -> np.ndarray:
        from agent.common.german_text import analyze

        matrix = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            for lexeme in analyze(text):
                digest = hashlib.blake2b(lexeme.encode("utf-8"), digest_size=8).digest()
                bucket = int.from_bytes(digest[:4], "big") % self.dimension
                sign = 1.0 if digest[4] % 2 == 0 else -1.0
                matrix[row, bucket] += sign
        return _normalise_rows(matrix)

    def encode_documents(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts)

    def encode_queries(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts)


class E5Embedder:
    name = "e5"

    def __init__(self, model_id: str = E5_MODEL_ID, cache_folder: str | None = None, batch_size: int = 64) -> None:
        from sentence_transformers import SentenceTransformer

        self.model_id = model_id
        self.batch_size = batch_size
        self._model = SentenceTransformer(model_id, cache_folder=cache_folder or os.environ.get(MODEL_CACHE_ENV))

    def _encode(self, texts: list[str], prefix: str) -> np.ndarray:
        vectors = self._model.encode(
            [f"{prefix}{text}" for text in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return np.asarray(vectors, dtype=np.float32)

    def encode_documents(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts, "passage: ")

    def encode_queries(self, texts: list[str]) -> np.ndarray:
        return self._encode(texts, "query: ")

    def truncation(self, texts: list[str]) -> tuple[int, int]:
        limit = int(self._model.max_seq_length)
        tokenizer = self._model.tokenizer
        over = sum(1 for text in texts if len(tokenizer.tokenize(f"passage: {text}")) > limit)
        return over, limit


@dataclass
class DenseIndex:
    chunks: list[Chunk]
    vectors: np.ndarray
    embedder_name: str

    def search(self, embedder: Embedder, question: str, top_k: int) -> list[Chunk]:
        query = embedder.encode_queries([question])[0]
        scores = self.vectors @ query
        if top_k >= len(self.chunks):
            order = np.argsort(-scores, kind="stable")
        else:
            top = np.argpartition(-scores, top_k)[:top_k]
            order = top[np.argsort(-scores[top], kind="stable")]
        return [self.chunks[int(position)] for position in order[:top_k]]


def build_dense_index(embedder: Embedder, chunks: list[Chunk]) -> DenseIndex:
    texts = [chunk.text for chunk in chunks]
    logger.info("Encoding %d chunks with %s", len(texts), embedder.name)
    return DenseIndex(chunks=list(chunks), vectors=embedder.encode_documents(texts), embedder_name=embedder.name)


def make_embedder(name: str) -> Embedder:
    if name == "hashed":
        return HashedEmbedder()
    if name == "e5":
        return E5Embedder()
    raise ValueError(f"unknown embedder {name!r}; expected 'hashed' or 'e5'")
