from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from dataclasses import field

from oib_retrieval.corpus import Chunk

try:
    from agent.common.german_text import DEFAULT_DF_CEILING_RATIO
except ImportError:  # pragma: no cover - the harness can run without the backend package
    DEFAULT_DF_CEILING_RATIO = 0.25


@dataclass
class LexicalIndex:
    chunks: list[Chunk]
    postings: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    frequencies: dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return len(self.chunks)

    def idf(self, lexeme: str) -> float:
        frequency = self.frequencies.get(lexeme, 0)
        if frequency <= 0:
            return 0.0
        return math.log((self.total + 1) / (frequency + 0.5))


def build_index(chunks: list[Chunk]) -> LexicalIndex:
    from agent.common.german_text import analyze

    index = LexicalIndex(chunks=list(chunks))
    postings: dict[str, set[int]] = defaultdict(set)
    for position, chunk in enumerate(index.chunks):
        for lexeme in analyze(chunk.text):
            postings[lexeme].add(position)
    index.postings = postings
    index.frequencies = {lexeme: len(rows) for lexeme, rows in postings.items()}
    return index


def selected_terms(
    index: LexicalIndex,
    question: str,
    extra_terms: tuple[str, ...] = (),
    df_ceiling_ratio: float = DEFAULT_DF_CEILING_RATIO,
) -> list[str]:
    from agent.common.german_text import analyze_query
    from agent.common.german_text import select_terms

    candidates = analyze_query(question, extra_terms=extra_terms)
    return select_terms(
        candidates,
        index.frequencies,
        index.total,
        df_ceiling_ratio=df_ceiling_ratio,
    )


def tsquery_for(
    index: LexicalIndex,
    question: str,
    extra_terms: tuple[str, ...] = (),
    df_ceiling_ratio: float = DEFAULT_DF_CEILING_RATIO,
) -> str:
    from agent.common.german_text import build_tsquery

    return build_tsquery(selected_terms(index, question, extra_terms, df_ceiling_ratio))


def search(
    index: LexicalIndex,
    question: str,
    top_k: int,
    extra_terms: tuple[str, ...] = (),
    df_ceiling_ratio: float = DEFAULT_DF_CEILING_RATIO,
) -> list[Chunk]:
    terms = selected_terms(index, question, extra_terms, df_ceiling_ratio)
    if not terms:
        return []

    scores: dict[int, float] = defaultdict(float)
    for term in terms:
        weight = index.idf(term)
        if weight <= 0.0:
            continue
        for position in index.postings.get(term, ()):
            scores[position] += weight

    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [index.chunks[position] for position, _score in ordered[:top_k]]
