from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

from oib_retrieval import corpus
from oib_retrieval import lexical
from oib_retrieval import metrics
from oib_retrieval import qrels
from oib_retrieval import structure

RETRIEVE_DEPTH = 120

PARITY_K = 16

CHANNELS = ("lexical", "dense", "hybrid")


def fixtures_dir() -> Path:
    return corpus.package_root() / "fixtures"


@dataclass(frozen=True)
class Scores:
    label: str
    questions: int
    recall: dict[int, float]
    ndcg: dict[int, float]
    mrr: float
    forbidden: dict[int, float]

    @staticmethod
    def compute(
        label: str,
        rankings: list[list[tuple[str, int]]],
        judgements: list[qrels.Judgements],
        forbidden: qrels.ForbiddenUnits,
    ) -> Scores:
        answerable = [(ranked, judged) for ranked, judged in zip(rankings, judgements, strict=True) if judged.graded]
        recall = {}
        ndcg = {}
        for k in metrics.K_VALUES:
            recall[k] = metrics.mean([metrics.recall_at_k(r, j.relevant, k) for r, j in answerable])
            ndcg[k] = metrics.mean([metrics.ndcg_at_k(r, j.graded, k) for r, j in answerable])
        reciprocal = metrics.mean([metrics.mrr(r, j.relevant) for r, j in answerable])
        forbidden_rates = {
            k: metrics.forbidden_rate(rankings, [forbidden] * len(rankings), k) for k in metrics.K_VALUES
        }
        return Scores(
            label=label,
            questions=len(answerable),
            recall=recall,
            ndcg=ndcg,
            mrr=reciprocal,
            forbidden=forbidden_rates,
        )


def _to_schema_chunks(chunks: list[corpus.Chunk]):
    from agent.knowledge.schema import Chunk as SchemaChunk

    return [
        SchemaChunk(
            chunk_id=chunk.chunk_id,
            content=chunk.text,
            score=max(0.0, 1.0 - position / max(len(chunks), 1)),
            file_name=chunk.file_name,
            page_number=chunk.page,
            display_citation=f"{chunk.file_name} p{chunk.page}",
            content_type="text",
            retrieval_rank=position,
            metadata={"collection": "oib_knowledge", **chunk.metadata},
        )
        for position, chunk in enumerate(chunks)
    ]


def _hybrid(
    dense_hits: list[corpus.Chunk],
    lexical_hits: list[corpus.Chunk],
    top_k: int,
    max_per_document: int = 5,
) -> list[tuple[str, int]]:
    from knowledge_layer.search import merge_results
    from knowledge_layer.search import reciprocal_rank_fusion

    fused = reciprocal_rank_fusion([dense_hits, lexical_hits], top_n=top_k)
    merged = merge_results(
        [
            type(
                "_Result",
                (),
                {"success": True, "chunks": _to_schema_chunks(fused), "backend": "oib_retrieval"},
            )()
        ],
        query="",
        top_k=top_k,
        backend_name="oib_retrieval",
        max_per_document=max_per_document,
    )
    units: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for chunk in merged.chunks:
        unit = (chunk.file_name, int(chunk.page_number))
        if unit not in seen:
            seen.add(unit)
            units.append(unit)
    return units


@dataclass(frozen=True)
class ArmRun:
    arm: str
    chunks: int
    scores: dict[str, dict[str, Scores]]
    rankings: dict[str, list[list[tuple[str, int]]]]
    unfiltered_rankings: dict[str, list[list[tuple[str, int]]]]
    truncated_chunks: int
    truncation_limit: int
    short_rankings: int


def _apply_production_filter(
    ranked: list[tuple[str, int]], excluded: frozenset[str], depth: int
) -> tuple[list[tuple[str, int]], bool]:
    kept = [unit for unit in ranked if unit[0] not in excluded]
    return kept, len(kept) < depth


def run_arm(
    arm: str,
    embedder_name: str,
    judgements: list[qrels.Judgements],
    forbidden: qrels.ForbiddenUnits,
    settings: corpus.ProductionRetrievalSettings,
    cache_dir: Path | None = None,
) -> ArmRun:
    from oib_retrieval import dense as dense_module

    chunks = corpus.build_arm(arm, cache_dir=cache_dir)
    lexical_index = lexical.build_index(chunks)
    embedder = dense_module.make_embedder(embedder_name)
    truncated, limit = (
        embedder.truncation([chunk.text for chunk in chunks]) if hasattr(embedder, "truncation") else (0, 0)
    )
    dense_index = dense_module.build_dense_index(embedder, chunks)

    unfiltered: dict[str, list[list[tuple[str, int]]]] = {channel: [] for channel in CHANNELS}
    rankings: dict[str, list[list[tuple[str, int]]]] = {channel: [] for channel in CHANNELS}
    short = 0
    for judged in judgements:
        question = judged.entry.question
        lexical_hits = lexical.search(lexical_index, question, RETRIEVE_DEPTH)
        dense_hits = dense_index.search(embedder, question, RETRIEVE_DEPTH)
        raw = {
            "lexical": corpus.dedupe_to_units(lexical_hits),
            "dense": corpus.dedupe_to_units(dense_hits),
            "hybrid": _hybrid(dense_hits, lexical_hits, RETRIEVE_DEPTH, settings.max_chunks_per_document),
        }
        for channel, ranked in raw.items():
            unfiltered[channel].append(ranked)
            kept, was_short = _apply_production_filter(ranked, settings.exclude_file_names, max(metrics.K_VALUES))
            if was_short and len(ranked) >= max(metrics.K_VALUES):
                short += 1
            rankings[channel].append(kept)

    subsets = {
        "all": list(range(len(judgements))),
        "de": [i for i, j in enumerate(judgements) if j.entry.language == "de"],
        "en": [i for i, j in enumerate(judgements) if j.entry.language == "en"],
    }
    scores = {
        channel: {
            subset: Scores.compute(
                f"{arm}/{channel}/{subset}",
                [rankings[channel][i] for i in indices],
                [judgements[i] for i in indices],
                forbidden,
            )
            for subset, indices in subsets.items()
        }
        for channel in CHANNELS
    }
    return ArmRun(
        arm=arm,
        chunks=len(chunks),
        scores=scores,
        rankings=rankings,
        unfiltered_rankings=unfiltered,
        truncated_chunks=truncated,
        truncation_limit=limit,
        short_rankings=short,
    )


def _parity(
    golden: qrels.GoldenSet, judgements: list[qrels.Judgements], rankings: list[list[tuple[str, int]]], k: int
) -> tuple[float, float, float, int]:
    by_id = {judged.entry.id: (judged, ranked) for judged, ranked in zip(judgements, rankings, strict=True)}
    german: list[float] = []
    english: list[float] = []
    pairs = golden.sibling_pairs()
    for de_entry, en_entry in pairs:
        de_judged, de_ranked = by_id[de_entry.id]
        en_judged, en_ranked = by_id[en_entry.id]
        if not de_judged.graded:
            continue
        german.append(metrics.recall_at_k(de_ranked, de_judged.relevant, k))
        english.append(metrics.recall_at_k(en_ranked, en_judged.relevant, k))
    de_mean = metrics.mean(german)
    en_mean = metrics.mean(english)
    return de_mean, en_mean, en_mean - de_mean, len(german)


def _refusal_fill(judgements: list[qrels.Judgements], rankings: list[list[tuple[str, int]]], k: int) -> float:
    values = [
        metrics.fill_rate(ranked, k)
        for judged, ranked in zip(judgements, rankings, strict=True)
        if judged.entry.should_refuse
    ]
    return metrics.mean(values)


def print_structure(report: structure.StructureReport, stream) -> None:
    print("\n=== 1. STRUCTURAL RETRIEVABILITY (real; no embedder, no key, no model) ===", file=stream)
    print(
        f"Punkt index: {report.indexed_clauses} Punkte, {report.located_clauses} located in the extracted text, "
        f"{report.structural_parents} structural parents excluded "
        f"-> {report.totals[corpus.ARM_PAGE].leaf_clauses} leaf Punkte measured.",
        file=stream,
    )
    if report.unlocated:
        print(f"Unlocated (not scored on either arm): {report.unlocated}", file=stream)
    header = f"{'arm':<8}{'chunks':>8}{'contiguous':>14}{'citable unit':>16}{'leaf Punkte/chunk':>20}"
    print(header, file=stream)
    print("-" * len(header), file=stream)
    for arm in corpus.ARMS:
        row = report.totals[arm]
        print(
            f"{arm:<8}{row.chunks:>8}"
            f"{row.contiguous:>7} ({row.contiguous_pct:5.1f}%)"
            f"{row.isolated:>9} ({row.isolated_pct:5.1f}%)"
            f"{row.clauses_per_chunk:>20.2f}",
            file=stream,
        )
    print(
        "contiguous = the Punkt's full text sits in ONE chunk. citable unit = that chunk holds no other leaf\n"
        "Punkt whole. leaf Punkte/chunk is a LOWER BOUND (a Punkt split across a boundary is not counted).",
        file=stream,
    )


def print_scores(scores: Scores, stream) -> None:
    recall = "  ".join(f"@{k}:{scores.recall[k]:.3f}" for k in metrics.K_VALUES)
    ndcg = "  ".join(f"@{k}:{scores.ndcg[k]:.3f}" for k in metrics.K_VALUES)
    print(f"  {scores.label:<28} n={scores.questions:<3}", file=stream)
    print(f"    recall {recall}", file=stream)
    print(f"    nDCG   {ndcg}", file=stream)
    print(f"    MRR    {scores.mrr:.3f}", file=stream)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Drive the harness and print the report.")
    parser.add_argument(
        "--embedder",
        default="hashed",
        choices=("hashed", "e5"),
        help="hashed = deterministic, offline, measures WIRING ONLY. e5 = a real local multilingual model "
        "(downloads once); still not production's embedder.",
    )
    parser.add_argument("--structure-only", action="store_true", help="Skip retrieval; print the chunking A/B only.")
    parser.add_argument(
        "--fail-below",
        type=float,
        default=None,
        metavar="PCT",
        help=(
            "Exit 1 when the Punkt arm's citable-unit share (percent of leaf Punkte whose chunk holds no other "
            "leaf Punkt whole) is below PCT. The regression gate: model-free, key-free, offline."
        ),
    )
    parser.add_argument("--arms", nargs="*", default=list(corpus.ARMS), choices=list(corpus.ARMS))
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    stream = sys.stdout

    index = qrels.load_clause_index(fixtures_dir() / "clause_index.json")
    golden = qrels.load_golden(fixtures_dir() / "oib_retrieval_golden.json")
    qrels.assert_siblings_share_qrels(golden, index)
    judgements = list(qrels.build_judgements(golden, index))

    print("OIB RETRIEVAL EVALUATION HARNESS", file=stream)
    print(
        f"{len(golden.entries)} golden entries "
        f"({len(golden.by_language('de'))} de / {len(golden.by_language('en'))} en, "
        f"{len(golden.sibling_pairs())} sibling pairs, "
        f"{sum(1 for e in golden.entries if e.should_refuse)} should-refuse, "
        f"{len(golden.entries) - len(golden.primary())} morphology variants). "
        "All entries are calibration_pending.",
        file=stream,
    )

    try:
        report = structure.measure_structure(index)
    except corpus.CorpusMissingError as exc:
        print(f"\nCANNOT RUN — {exc}", file=stream)
        return 1
    print_structure(report, stream)
    if args.fail_below is not None:
        citable_pct = report.totals[corpus.ARM_CLAUSE].isolated_pct
        if citable_pct < args.fail_below:
            print(
                f"\nFAIL: the Punkt arm's citable-unit share is {citable_pct:.1f}%, "
                f"below the {args.fail_below:.1f}% gate. A chunker or German-analyzer change made "
                "fewer Punkte survive as a citable unit (rag-system-audit-2026-08 Part IV; ADR-0058 rule 7).",
                file=stream,
            )
            return 1
        print(f"\nGATE: citable-unit share {citable_pct:.1f}% >= {args.fail_below:.1f}%.", file=stream)
    if args.structure_only:
        return 0

    forbidden = qrels.ForbiddenUnits(golden.forbidden_file_prefixes)
    print(f"\n=== 2-4. RETRIEVAL (embedder: {args.embedder}) ===", file=stream)
    if args.embedder == "hashed":
        print(
            "WIRING ONLY. The hashed embedder has no semantics; its dense and hybrid numbers prove the\n"
            "pipeline runs end to end and say NOTHING about retrieval quality. Re-run with --embedder e5\n"
            "for a real relative measurement, and against production's embedder for an absolute one.",
            file=stream,
        )
    else:
        print(
            "The dense arm is intfloat/multilingual-e5-small run locally. This is NOT production's embedder\n"
            "(openai/text-embedding-3-large via OpenRouter). Valid for the RELATIVE comparisons below, because\n"
            "both sides of each see the same model; not a claim about production's absolute recall.",
            file=stream,
        )

    settings = corpus.production_retrieval_settings()
    if settings.top_k != PARITY_K:
        print(
            f"\nWARNING: PARITY_K={PARITY_K} but production top_k={settings.top_k}. "
            f"The language-parity headline is quoted at a depth production does not use. "
            f"Update PARITY_K in {__name__} to match, or state the discrepancy when citing it.",
            file=stream,
        )
    print(
        f"\nProduction settings read from configs/config_oib_openrouter.yml: top_k={settings.top_k}, "
        f"max_chunks_per_document={settings.max_chunks_per_document}, "
        f"{len(settings.exclude_file_names)} excluded file names. "
        f"Retrieval scores are reported AFTER that query-time exclusion; forbidden@{PARITY_K} is reported on "
        "the UNFILTERED ranking, because that is the only place it can be measured — with the filter on it is "
        "structurally zero and tells nobody whether the list is still complete.",
        file=stream,
    )

    for arm in args.arms:
        run = run_arm(arm, args.embedder, judgements, forbidden, settings)
        print(f"\n--- arm: {arm} ({run.chunks} chunks) ---", file=stream)
        if run.truncation_limit:
            print(
                f"    embedder input limit {run.truncation_limit} tokens; "
                f"{run.truncated_chunks} of {run.chunks} chunks "
                f"({100.0 * run.truncated_chunks / run.chunks if run.chunks else 0.0:.1f}%) "
                "are truncated before embedding — a handicap this arm carries under THIS model only.",
                file=stream,
            )
        if run.short_rankings:
            print(
                f"    WARNING: {run.short_rankings} ranking(s) fell below {max(metrics.K_VALUES)} results after the "
                "production filter, so post-filtering was not exactly equivalent to pre-filtering there.",
                file=stream,
            )
        for channel in CHANNELS:
            for subset in ("all", "de", "en"):
                print_scores(run.scores[channel][subset], stream)
            de_mean, en_mean, delta, pairs = _parity(golden, judgements, run.rankings[channel], PARITY_K)
            print(
                f"    language parity recall@{PARITY_K} over {pairs} sibling pairs: "
                f"de {de_mean:.3f} / en {en_mean:.3f} / delta {delta:+.3f}",
                file=stream,
            )
            print(
                f"    should-refuse fill@{PARITY_K}: {_refusal_fill(judgements, run.rankings[channel], PARITY_K):.3f} "
                "(1.000 = top_k always filled, i.e. no abstention path)",
                file=stream,
            )
            unfiltered_forbidden = metrics.forbidden_rate(
                run.unfiltered_rankings[channel],
                [forbidden] * len(judgements),
                PARITY_K,
            )
            print(
                f"    forbidden@{PARITY_K} WITHOUT the production filter: {unfiltered_forbidden:.3f} "
                "(share of questions whose top-16 would cite a change-log page)",
                file=stream,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
