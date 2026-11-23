from __future__ import annotations

import contextlib
import re
import uuid
from collections import Counter
from collections.abc import Iterator
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

SPLIT_SCOPE = "oib_parity_split"
MIN_WORD = 8
MIN_PART = 4
PROPOSALS = 3
_WORD = re.compile(r"[^\W\d_]+")
_NAMESPACE = uuid.UUID("5f1d2c9e-7a43-4b0e-9d6a-3c2b1e0f8a77")


@dataclass(frozen=True)
class Variant:
    ranking: Any
    query_parts: bool = True


def available() -> bool:
    try:
        import split_words  # noqa: F401
    except ImportError:
        return False
    return True


class Decompounder:
    def __init__(self, texts: Sequence[str]):
        from split_words import Splitter

        self._splitter = Splitter()
        counts = Counter(word.lower() for text in texts for word in _WORD.findall(text))
        self.vocabulary = {word for word, count in counts.items() if count >= 2 and len(word) >= MIN_PART}
        self._cache: dict[str, tuple[str, ...]] = {}

    def _known(self, part: str) -> str | None:
        part = part.lower()
        if part in self.vocabulary:
            return part
        if part.endswith("s") and part[:-1] in self.vocabulary:
            return part[:-1]
        return None

    def parts(self, word: str) -> tuple[str, ...]:
        key = word.lower()
        if key in self._cache:
            return self._cache[key]
        found: tuple[str, ...] = ()
        if len(key) >= MIN_WORD:
            for _score, body, head in self._splitter.split_compound(key)[:PROPOSALS]:
                first, last = self._known(body), self._known(head)
                if first and last and len(first) >= MIN_PART and len(last) >= MIN_PART:
                    found = (*(self.parts(first) or (first,)), *(self.parts(last) or (last,)))
                    break
        self._cache[key] = found
        return found

    def expand(self, text: str) -> list[str]:
        seen: dict[str, None] = {}
        for word in _WORD.findall(text):
            for part in self.parts(word):
                seen.setdefault(part, None)
        return list(seen)


def build_split_scope(decompounder: Decompounder, source_scope: str) -> dict[str, int]:
    from knowledge_layer.vector_store import DENSE
    from knowledge_layer.vector_store import LEXICAL
    from knowledge_layer.vector_store import SCOPE_FIELD
    from knowledge_layer.vector_store import bm25
    from knowledge_layer.vector_store import get_store
    from knowledge_layer.vector_store import scope_filter
    from qdrant_client import models

    store = get_store()
    alias = store.alias(source_scope)
    offset: Any = None
    copied = expanded = 0
    while True:
        page, offset = store.client.scroll(
            alias, scroll_filter=scope_filter([source_scope]), limit=256, offset=offset, with_vectors=[DENSE]
        )
        points = []
        for record in page:
            payload = dict(record.payload or {})
            text = str(payload.get("text") or "")
            extra = decompounder.expand(text)
            expanded += bool(extra)
            payload[SCOPE_FIELD] = SPLIT_SCOPE
            vector: dict[str, Any] = {DENSE: record.vector[DENSE]}
            if text.strip():
                vector[LEXICAL] = bm25(" ".join([text, *extra]))
            points.append(
                models.PointStruct(id=str(uuid.uuid5(_NAMESPACE, str(record.id))), vector=vector, payload=payload)
            )
        if points:
            store.client.upsert(alias, points, wait=True)
            copied += len(points)
        if offset is None:
            return {"copied": copied, "with_parts": expanded}


@contextlib.contextmanager
def query_side(decompounder: Decompounder, corpus_texts: Sequence[str], *, query_parts: bool = True) -> Iterator[None]:
    from knowledge_layer.vector_store import retrieval

    documents = [set(_WORD.findall(text.lower())) | set(decompounder.expand(text)) for text in corpus_texts]
    original_candidates, original_frequencies = retrieval.bm25_candidates, retrieval.term_frequencies
    parts: set[str] = set()
    split_vocabulary = {part for text in corpus_texts for part in decompounder.expand(text)}

    def candidates(query: str, extra_terms: Sequence[str] = ()) -> list[str]:
        base = original_candidates(query, extra_terms)
        added = [part for part in decompounder.expand(query) if part not in base] if query_parts else []
        parts.update(added)
        return [*base, *added]

    def frequencies(scopes: Any, terms: Sequence[str], cache: Any = None) -> tuple[int, dict[str, int]]:
        counted = parts if query_parts else split_vocabulary
        total, counts = original_frequencies(scopes, [t for t in terms if t not in counted], cache)
        for term in terms:
            if term in counted:
                counts[term] = sum(1 for words in documents if term in words)
        return total, counts

    retrieval.bm25_candidates, retrieval.term_frequencies = candidates, frequencies
    try:
        yield
    finally:
        retrieval.bm25_candidates, retrieval.term_frequencies = original_candidates, original_frequencies
