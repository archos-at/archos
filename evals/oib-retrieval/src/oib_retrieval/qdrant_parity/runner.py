from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

from oib_retrieval import corpus
from oib_retrieval.qdrant_parity import baseline
from oib_retrieval.qdrant_parity import dimension
from oib_retrieval.qdrant_parity import evaluation
from oib_retrieval.qdrant_parity import stores
from oib_retrieval.qdrant_parity import variants
from oib_retrieval.qdrant_parity.inputs import Inputs
from oib_retrieval.qdrant_parity.inputs import load_inputs
from oib_retrieval.qdrant_parity.measures import HYBRID_DEPTH
from oib_retrieval.qdrant_parity.measures import Corpus
from oib_retrieval.qdrant_parity.measures import measure_dimension
from oib_retrieval.qdrant_parity.measures import measure_exact
from oib_retrieval.qdrant_parity.measures import measure_hybrid
from oib_retrieval.qdrant_parity.measures import measure_hybrid_hard
from oib_retrieval.qdrant_parity.measures import measure_lexical
from oib_retrieval.qdrant_parity.report_markdown import render_markdown

logger = logging.getLogger(__name__)


def environment(qdrant_url: str) -> dict[str, str]:
    info = {
        "python": platform.python_version(),
        "machine": platform.machine(),
        "cpus": str(os.cpu_count()),
        "qdrant_url": qdrant_url,
    }
    try:
        import httpx

        info["qdrant"] = httpx.get(qdrant_url, timeout=5).json().get("version", "?")
    except Exception:  # noqa: BLE001 - informational only
        info["qdrant"] = "?"
    cpu = _cpu_model()
    if cpu is not None:
        info["cpu"] = cpu
    return info


def _cpu_model() -> str | None:
    try:
        text = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("model name"):
            return line.split(":", 1)[1].strip()
    return None


def run(
    inputs: Inputs,
    *,
    qdrant_url: str,
    rounds: int,
    with_dimension: bool = True,
    variant_names: str | None = None,
) -> dict[str, Any]:
    corpus_view = Corpus(inputs.chunks, inputs.excluded)
    fingerprint = stores.identity(inputs.model, inputs.base_url)
    report: dict[str, Any] = {
        "corpus": {
            "chunks": len(inputs.chunks),
            "allowed_chunks": sum(1 for c in inputs.chunks if corpus_view.allowed(c)),
            "files": len({c.file_name for c in inputs.chunks}),
            "dimension": int(inputs.doc_vectors.shape[1]),
        },
        "embedder": {"name": inputs.embedder, "model": inputs.model, "embedded_this_run": inputs.embedded_now},
        "queries": {
            "golden": len(inputs.judgements),
            "golden_answerable": sum(1 for j in inputs.judgements if j.graded),
            "overview": len(inputs.overview),
            "hard_cases": len(inputs.hard_cases),
        },
        "reference": baseline.SOURCE,
    }
    with stores.isolated_qdrant(qdrant_url):
        report["environment"] = environment(qdrant_url)
        report["corpus"]["qdrant_count"] = stores.fill_qdrant(inputs.chunks, inputs.doc_vectors, fingerprint)
        report["qdrant_index"] = stores.wait_until_indexed()

        queries = list(inputs.query_vectors)
        matrix = np.stack([inputs.query_vectors[q] for q in queries])
        reader = stores.retriever(inputs.model, inputs.base_url, queries, matrix)

        report["lexical"] = measure_lexical(inputs, corpus_view, reader)
        report["exact"] = measure_exact(inputs, corpus_view, reader)
        report["hybrid"] = measure_hybrid(inputs, reader, rounds)
        report["hybrid_hard"] = measure_hybrid_hard(inputs, reader, report["lexical"]["relevant_counts"])
        if variant_names:
            report["variants"] = variants.run(
                inputs, reader, report["lexical"]["relevant_counts"], variant_names, rounds, HYBRID_DEPTH
            )
        if with_dimension:
            from knowledge_layer.vector_store import get_store

            report["dimension"] = measure_dimension(inputs, corpus_view, get_store().client)
    report["verdicts"] = [asdict(v) for v in verdicts(report)]
    return _plain(report)


def verdicts(report: dict[str, Any]) -> list[evaluation.Verdict]:
    lexical = report["lexical"]
    exact_mismatches = sum(1 for row in report["exact"] if not row["identical"])
    out = [
        evaluation.g1b_lexical_verdict(
            lexical["golden"]["qdrant_bm25"],
            baseline.LEXICAL_GOLDEN,
            evaluation.mean_hard(lexical["hard"]["qdrant_bm25"], gating_only=True),
            baseline.LEXICAL_HARD,
            exact_mismatches,
        ),
        evaluation.g2_latency_verdict(report["hybrid"]["latency_ms"]),
    ]
    dim = report.get("dimension")
    if dim and dim["dimension"] == dimension.FULL:
        out.append(evaluation.g6_dimension_verdict(dim["exact_full"], dim["exact_reduced"], label="exact cosine"))
        if "qdrant_q3072" in dim:
            out.append(
                evaluation.g6_dimension_verdict(
                    dim["qdrant_q3072"], dim["qdrant_q1024"], label="HNSW + TurboQuant 4-bit"
                )
            )
    else:
        out.append(evaluation.Verdict("G6 dimension", "not measured", "needs the production 3072-d vectors"))
    out.append(
        evaluation.Verdict("G1 answer quality", "not measured", "needs a running stack: task be:eval:answer-suite")
    )
    out.append(evaluation.Verdict("G3 isolation", "not measured here", "the knowledge-layer isolation property test"))
    out.append(evaluation.Verdict("G4 operations / G5 memory", "not measured here", "ops drills on the cluster"))
    return out


def _plain(value: Any) -> Any:
    if isinstance(value, evaluation.RankScores):
        return value.as_dict()
    if isinstance(value, evaluation.HardCaseScore):
        return asdict(value)
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, float):
        return round(value, 4)
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="``task be:eval:qdrant-parity``: run the Qdrant retrieval gates on the OIB corpus."
    )
    parser.add_argument("--embedder", choices=("production", "hashed"), default="production")
    parser.add_argument("--qdrant-url", default=os.environ.get("QDRANT_TEST_URL") or "http://localhost:6333")
    parser.add_argument("--rounds", type=int, default=5, help="timed passes over every question (G2)")
    parser.add_argument("--out", type=Path, default=corpus.package_root() / "results" / "qdrant_parity")
    parser.add_argument("--no-dimension", action="store_true", help="skip G6")
    parser.add_argument(
        "--variants",
        default=None,
        help="also run the ranking sweep: a comma list of variants.catalogue() names, or 'all'",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    try:
        inputs = load_inputs(args.embedder, corpus.package_root() / ".cache" / "qdrant_parity")
    except corpus.CorpusMissingError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if not inputs.chunks:
        print("error: no corpus chunks; put the OIB PDFs in data/oib (see data/oib/README.md)", file=sys.stderr)
        return 1
    report = run(
        inputs,
        qdrant_url=args.qdrant_url,
        rounds=args.rounds,
        with_dimension=not args.no_dimension,
        variant_names=args.variants,
    )
    markdown = render_markdown(report)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (args.out / "report.md").write_text(markdown, encoding="utf-8")
    print(markdown)
    print(f"written: {args.out / 'results.json'}, {args.out / 'report.md'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
