from __future__ import annotations

from oib_retrieval.qdrant_parity.evaluation import RankScores

SOURCE = "qdrant-gates-2026-10.md, final run 2026-10-13 (Chroma path)"

LEXICAL_GOLDEN = RankScores(
    queries=24,
    recall={5: 0.521, 10: 0.646, 16: 0.854},
    ndcg={10: 0.461},
    mrr=0.414,
)

LEXICAL_HARD = {"cases": 21, "precision": 0.619, "r_precision": 0.539, "mrr": 0.714}

HYBRID = {
    "golden_all": RankScores(queries=46, recall={10: 0.989, 16: 1.0, 60: 1.0}, ndcg={10: 0.782}, mrr=0.725),
    "golden_de": RankScores(queries=24, recall={10: 1.0, 16: 1.0, 60: 1.0}, ndcg={10: 0.801}, mrr=0.751),
    "golden_en": RankScores(queries=22, recall={10: 0.977, 16: 1.0, 60: 1.0}, ndcg={10: 0.761}, mrr=0.697),
}

OVERVIEW = {
    "exact-id": {"recall@16": 0.900, "recall_pool": 0.900, "mrr": 0.528},
    "overview": {"recall@16": 0.950, "recall_pool": 0.983, "mrr": 0.632},
    "paraphrase": {"recall@16": 1.000, "recall_pool": 1.000, "mrr": 0.750},
}

HYBRID_HARD_R_PRECISION = 0.543

LATENCY_MS = {"n": 380, "p50": 58.3, "p95": 88.9, "p99": 120.2, "mean": 59.6}
