from __future__ import annotations

import json
import math
import re
from collections.abc import Hashable
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from oib_retrieval import metrics

HARD_CASE_KINDS = ("paragraph", "punkt_number", "allcaps_code", "compound", "compound_only", "umlaut_sz")

NON_GATING_KINDS = frozenset({"compound_only"})

G2_P95_MS = 230.0
G6_MAX_DROP = 0.01

HYBRID_K = (1, 3, 5, 10, 16, 60)
HARD_CASE_PRECISION_K = 10


@dataclass(frozen=True)
class HardCase:
    id: str
    kind: str
    query: str
    oracle: str
    exclude: str | None = None
    notes: str = ""

    def relevant(self, text: str) -> bool:
        if not re.search(self.oracle, text, re.IGNORECASE):
            return False
        return not (self.exclude and re.search(self.exclude, text, re.IGNORECASE))


def load_hard_cases(path: str | Path) -> list[HardCase]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    cases: list[HardCase] = []
    seen: set[str] = set()
    for raw in payload["cases"]:
        case = HardCase(
            id=raw["id"],
            kind=raw["kind"],
            query=raw["query"],
            oracle=raw["oracle"],
            exclude=raw.get("exclude"),
            notes=raw.get("notes", ""),
        )
        if case.id in seen:
            raise ValueError(f"duplicate hard case id {case.id!r}")
        seen.add(case.id)
        if case.kind not in HARD_CASE_KINDS:
            raise ValueError(f"{case.id!r}: unknown kind {case.kind!r}")
        if not case.query.strip():
            raise ValueError(f"{case.id!r}: empty query")
        re.compile(case.oracle)
        if case.exclude:
            re.compile(case.exclude)
        cases.append(case)
    missing = set(HARD_CASE_KINDS) - {case.kind for case in cases}
    if missing:
        raise ValueError(f"hard-case fixture lacks kinds {sorted(missing)}")
    return cases


@dataclass(frozen=True)
class RankScores:
    queries: int
    recall: dict[int, float]
    ndcg: dict[int, float]
    mrr: float

    def as_dict(self) -> dict:
        return {
            "queries": self.queries,
            "recall": {str(k): round(v, 4) for k, v in self.recall.items()},
            "ndcg": {str(k): round(v, 4) for k, v in self.ndcg.items()},
            "mrr": round(self.mrr, 4),
        }


def score_graded(
    rankings: Sequence[Sequence[Hashable]], graded: Sequence[dict[Hashable, int]], ks: Sequence[int]
) -> RankScores:
    pairs = [(ranked, grades) for ranked, grades in zip(rankings, graded, strict=True) if grades]
    recall = {k: metrics.mean([metrics.recall_at_k(r, set(g), k) for r, g in pairs]) for k in ks}
    ndcg = {k: metrics.mean([metrics.ndcg_at_k(r, g, k) for r, g in pairs]) for k in ks}
    reciprocal = metrics.mean([metrics.mrr(r, set(g)) for r, g in pairs])
    return RankScores(queries=len(pairs), recall=recall, ndcg=ndcg, mrr=reciprocal)


@dataclass(frozen=True)
class HardCaseScore:
    case_id: str
    kind: str
    relevant: int
    precision: float
    r_precision: float
    mrr: float
    returned: int


def score_hard_case(case: HardCase, ranked_texts: Sequence[str], relevant_total: int) -> HardCaseScore:
    hits = [case.relevant(text) for text in ranked_texts]
    top = hits[:HARD_CASE_PRECISION_K]
    precision = sum(top) / HARD_CASE_PRECISION_K
    depth = max(relevant_total, 1)
    r_precision = sum(hits[:depth]) / depth if relevant_total else 0.0
    first = next((rank for rank, hit in enumerate(hits, start=1) if hit), None)
    return HardCaseScore(
        case_id=case.id,
        kind=case.kind,
        relevant=relevant_total,
        precision=precision,
        r_precision=r_precision,
        mrr=1.0 / first if first else 0.0,
        returned=len(ranked_texts),
    )


def mean_hard(scores: Sequence[HardCaseScore], *, gating_only: bool = False) -> dict[str, float]:
    kept = [s for s in scores if s.relevant and (not gating_only or s.kind not in NON_GATING_KINDS)]
    return {
        "cases": len(kept),
        "precision": metrics.mean([s.precision for s in kept]),
        "r_precision": metrics.mean([s.r_precision for s in kept]),
        "mrr": metrics.mean([s.mrr for s in kept]),
    }


def percentile(samples: Sequence[float], q: float) -> float:
    if not samples:
        return math.nan
    ordered = sorted(samples)
    position = (len(ordered) - 1) * q / 100.0
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def latency_summary(samples_ms: Sequence[float]) -> dict[str, float]:
    return {
        "n": len(samples_ms),
        "p50": round(percentile(samples_ms, 50), 2),
        "p95": round(percentile(samples_ms, 95), 2),
        "p99": round(percentile(samples_ms, 99), 2),
        "mean": round(sum(samples_ms) / len(samples_ms), 2) if samples_ms else math.nan,
    }


@dataclass(frozen=True)
class Verdict:
    gate: str
    status: str  # "pass" | "fail" | "not measured"
    detail: str


def g1b_lexical_verdict(
    qdrant_golden: RankScores,
    reference_golden: RankScores,
    qdrant_hard: dict[str, float],
    reference_hard: dict[str, float],
    exact_mismatches: int,
    *,
    k: int = 16,
    tolerance: float = 0.0,
) -> Verdict:
    reasons: list[str] = []
    if qdrant_golden.recall[k] + tolerance < reference_golden.recall[k]:
        reasons.append(f"golden recall@{k} {qdrant_golden.recall[k]:.3f} < reference {reference_golden.recall[k]:.3f}")
    if qdrant_hard["r_precision"] + tolerance < reference_hard["r_precision"]:
        reasons.append(
            f"hard-case R-precision {qdrant_hard['r_precision']:.3f} < reference {reference_hard['r_precision']:.3f}"
        )
    if exact_mismatches:
        reasons.append(f"exact mode differs from a full regex scan on {exact_mismatches} phrase(s)")
    if reasons:
        return Verdict("G1b lexical", "fail", "; ".join(reasons))
    return Verdict(
        "G1b lexical",
        "pass",
        f"golden recall@{k} {qdrant_golden.recall[k]:.3f} >= {reference_golden.recall[k]:.3f}; "
        f"hard-case R-precision {qdrant_hard['r_precision']:.3f} >= {reference_hard['r_precision']:.3f}; "
        "exact mode identical to a full scan",
    )


def g2_latency_verdict(qdrant_ms: dict[str, float]) -> Verdict:
    p95 = qdrant_ms["p95"]
    status = "pass" if p95 <= G2_P95_MS else "fail"
    return Verdict("G2 latency", status, f"Qdrant p95 {p95:.1f} ms vs {G2_P95_MS:.0f} ms bound (local single node)")


G6_K = (1, 5, 16)


def g6_dimension_verdict(full: RankScores, reduced: RankScores, *, label: str) -> Verdict:
    drops = {k: full.recall[k] - reduced.recall[k] for k in G6_K}
    status = "pass" if all(drop <= G6_MAX_DROP + 1e-9 for drop in drops.values()) else "fail"
    detail = ", ".join(
        f"recall@{k} {reduced.recall[k]:.3f} vs {full.recall[k]:.3f} ({-drops[k] * 100:+.1f})" for k in G6_K
    )
    return Verdict(f"G6 dimension ({label})", status, f"{detail}; bound -1.0 point; {full.queries} queries")
