from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from oib_retrieval import metrics
from oib_retrieval import qrels
from oib_retrieval.qdrant_parity import channels
from oib_retrieval.qdrant_parity import dimension
from oib_retrieval.qdrant_parity import evaluation
from oib_retrieval.qdrant_parity.inputs import Inputs
from oib_retrieval.qdrant_parity.stores import IndexedChunk

HYBRID_DEPTH = 60
LEXICAL_DEPTH = 120
LEXICAL_K = (1, 5, 10, 16, 20)

EXTRA_EXACT_PHRASES = (
    "Fluchtweg",
    "Geschoß",
    "Gebäudeklasse 5",
    "Rauchabzugseinrichtung",
    "barrierefrei",
    "OIB Richtlinie 2",
    "mindestens 2,00 m",
    "Brandwand",
    "Stiegenhaus",
    "nicht brennbar",
)


class Corpus:
    def __init__(self, chunks: Sequence[IndexedChunk], excluded: frozenset[str]):
        self.chunks = list(chunks)
        self.by_id = {chunk.chunk_id: chunk for chunk in chunks}
        self.excluded = excluded

    def allowed(self, chunk: IndexedChunk) -> bool:
        return chunk.file_name not in self.excluded and chunk.metadata.get("chunking") != channels.NON_EVIDENCE_CHUNKING

    def allowed_ids(self, ids: Sequence[str]) -> list[IndexedChunk]:
        return [self.by_id[i] for i in ids if i in self.by_id and self.allowed(self.by_id[i])]

    @staticmethod
    def units(chunks: Sequence[Any]) -> list[qrels.Unit]:
        seen: dict[qrels.Unit, None] = {}
        for chunk in chunks:
            page = getattr(chunk, "page", None)
            if page is None:
                page = getattr(chunk, "page_number", None)
            if page is None:
                continue
            seen.setdefault(qrels.Unit(chunk.file_name, int(page)), None)
        return list(seen)

    @staticmethod
    def files(chunks: Sequence[Any]) -> list[str]:
        return list(dict.fromkeys(chunk.file_name for chunk in chunks))


def _graded(judgements: Sequence[qrels.Judgements]) -> list[dict]:
    return [dict(judged.graded) for judged in judgements]


def measure_lexical(inputs: Inputs, corpus_view: Corpus, retriever: Any) -> dict[str, Any]:
    filters = channels.base_filters(sorted(inputs.excluded))
    german = [j for j in inputs.judgements if j.entry.language == "de"]

    def rank(query: str) -> list[IndexedChunk]:
        return corpus_view.allowed_ids(channels.qdrant_bm25(retriever, query, LEXICAL_DEPTH, filters))

    allowed_chunks = [chunk for chunk in corpus_view.chunks if corpus_view.allowed(chunk)]
    relevant_counts = {
        case.id: sum(1 for chunk in allowed_chunks if case.relevant(chunk.text)) for case in inputs.hard_cases
    }
    de_rankings = [Corpus.units(rank(j.entry.question)) for j in german]
    golden = {
        "qdrant_bm25": evaluation.score_graded(de_rankings, _graded(german), LEXICAL_K),
        "qdrant_bm25:empty": sum(1 for r in de_rankings if not r) / max(len(de_rankings), 1),
    }
    hard = {
        "qdrant_bm25": [
            evaluation.score_hard_case(case, [c.text for c in rank(case.query)], relevant_counts[case.id])
            for case in inputs.hard_cases
        ]
    }
    return {"golden": golden, "hard": hard, "relevant_counts": relevant_counts}


def measure_exact(inputs: Inputs, corpus_view: Corpus, retriever: Any) -> list[dict[str, Any]]:
    filters = channels.base_filters(sorted(inputs.excluded))
    phrases = list(dict.fromkeys([case.query for case in inputs.hard_cases] + list(EXTRA_EXACT_PHRASES)))
    allowed = [chunk for chunk in corpus_view.chunks if corpus_view.allowed(chunk)]
    rows: list[dict[str, Any]] = []
    for phrase in phrases:
        scan = channels.regex_oracle(allowed, phrase)
        found = channels.exact_matches(retriever, phrase, filters)
        index_only = channels.phrase_index_matches(phrase, filters)
        rows.append(
            {
                "phrase": phrase,
                "regex_scan": len(scan),
                "qdrant_find_text": len(found),
                "identical": scan == found,
                "only_scan": len(scan - found),
                "only_qdrant": len(found - scan),
                "phrase_index": len(index_only),
                "phrase_index_misses": len(scan - index_only),
                "phrase_index_extra": len(index_only - scan),
            }
        )
    return rows


def measure_hybrid(inputs: Inputs, retriever: Any, rounds: int) -> dict[str, Any]:
    filters = channels.base_filters(sorted(inputs.excluded))
    answerable = [j for j in inputs.judgements if j.graded]
    questions = [j.entry.question for j in answerable] + [e.question for e in inputs.overview]
    rankings: dict[str, list[Any]] = {}
    latency: list[float] = []
    for round_index in range(rounds + 1):  # round 0 warms caches and is not timed
        _hybrid_round(retriever, questions, filters, rankings if round_index == 0 else None, latency)
    unit_rankings = [Corpus.units(rankings[j.entry.question]) for j in answerable]

    def golden(language: str | None) -> evaluation.RankScores:
        pairs = [(r, j) for r, j in zip(unit_rankings, answerable, strict=True) if language in (None, j.entry.language)]
        return evaluation.score_graded([r for r, _ in pairs], _graded([j for _, j in pairs]), evaluation.HYBRID_K)

    files = {question: Corpus.files(hits) for question, hits in rankings.items()}
    return {
        "latency_ms": evaluation.latency_summary(latency),
        "golden_all": golden(None),
        "golden_de": golden("de"),
        "golden_en": golden("en"),
        "overview": _overview_scores(inputs.overview, rankings),
        "overview_per_query": {
            entry.id: {
                "first_expected_rank": next(
                    (rank for rank, f in enumerate(files[entry.question], 1) if f in entry.expected), None
                ),
                "recall@16": metrics.recall_at_k(files[entry.question], set(entry.expected), 16),
                "top_files": files[entry.question][:3],
            }
            for entry in inputs.overview
        },
    }


def _hybrid_round(
    retriever: Any, questions: Sequence[str], filters: Any, rankings: dict[str, list[Any]] | None, latency: list[float]
) -> None:
    for question in questions:
        hits, elapsed = channels.hybrid(retriever, question, HYBRID_DEPTH, filters)
        if rankings is not None:
            rankings[question] = hits
        else:
            latency.append(elapsed)


def measure_hybrid_hard(inputs: Inputs, retriever: Any, relevant: dict[str, int]) -> list[evaluation.HardCaseScore]:
    filters = channels.base_filters(sorted(inputs.excluded))
    return [
        evaluation.score_hard_case(
            case,
            [chunk.content for chunk in channels.hybrid(retriever, case.query, HYBRID_DEPTH, filters)[0]],
            relevant[case.id],
        )
        for case in inputs.hard_cases
    ]


def _overview_scores(entries: Sequence[Any], rankings: dict[str, list[Any]]) -> dict[str, dict[str, float]]:
    by_cohort: dict[str, list[tuple[list[str], set[str]]]] = {}
    for entry in entries:
        by_cohort.setdefault(entry.cohort, []).append((Corpus.files(rankings[entry.question]), set(entry.expected)))
    return {
        cohort: {
            "queries": len(pairs),
            "recall@16": round(metrics.mean([metrics.recall_at_k(r, rel, 16) for r, rel in pairs]), 4),
            "recall_pool": round(metrics.mean([len(rel & set(r)) / len(rel) for r, rel in pairs]), 4),
            "mrr": round(metrics.mean([metrics.mrr(r, rel) for r, rel in pairs]), 4),
        }
        for cohort, pairs in sorted(by_cohort.items())
    }


def measure_dimension(inputs: Inputs, corpus_view: Corpus, client: Any | None) -> dict[str, Any]:
    answerable = [j for j in inputs.judgements if j.graded]
    queries = np.stack([inputs.query_vectors[j.entry.question] for j in answerable])
    docs = inputs.doc_vectors / np.linalg.norm(inputs.doc_vectors, axis=1, keepdims=True)
    queries = queries / np.linalg.norm(queries, axis=1, keepdims=True)
    depth = 400  # deep enough that dropping excluded files leaves the 60 scored

    def unit_of(row: int) -> qrels.Unit:
        chunk = corpus_view.chunks[row]
        return qrels.Unit(chunk.file_name, chunk.page)

    def allowed(row: int) -> bool:
        return corpus_view.allowed(corpus_view.chunks[row])

    def scores(rows_per_query: list[list[int]]) -> evaluation.RankScores:
        units = [dimension.to_units(rows, unit_of, allowed, HYBRID_DEPTH) for rows in rows_per_query]
        return evaluation.score_graded(units, _graded(answerable), evaluation.HYBRID_K)

    full = docs.shape[1]
    reduced = dimension.REDUCED if full > dimension.REDUCED else full // 2
    result: dict[str, Any] = {
        "dimension": int(full),
        "reduced": int(reduced),
        "exact_full": scores(dimension.exact_rankings(docs, queries, depth)),
        "exact_reduced": scores(
            dimension.exact_rankings(
                dimension.truncate_renormalise(docs, reduced), dimension.truncate_renormalise(queries, reduced), depth
            )
        ),
    }
    if client is not None and full == dimension.FULL:
        ann, info = dimension.qdrant_rankings(client, docs, queries, depth)
        result["qdrant_index"] = info
        for variant, rows in ann.items():
            result[f"qdrant_{variant}"] = scores(rows)
    return result
