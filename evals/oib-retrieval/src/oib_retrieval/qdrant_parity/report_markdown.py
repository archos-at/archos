from __future__ import annotations

from typing import Any

from oib_retrieval.qdrant_parity import baseline
from oib_retrieval.qdrant_parity import dimension
from oib_retrieval.qdrant_parity import evaluation
from oib_retrieval.qdrant_parity import variants
from oib_retrieval.qdrant_parity.measures import HYBRID_DEPTH


def _fmt(value: Any) -> str:
    return f"{value:.3f}" if isinstance(value, float) else str(value)


def _hard_tables(
    lines: list[str], hard: dict[str, list[dict]], relevant_counts: dict[str, int], reference: dict[str, Any]
) -> None:
    names = list(hard)
    lines.append("| case | kind | relevant | " + " | ".join(f"{n} P@10 / R-prec" for n in names) + " |")
    lines.append("|---|---|---|" + "---|" * len(names))
    by_channel = {name: {row["case_id"]: row for row in rows} for name, rows in hard.items()}
    for case_id, relevant in relevant_counts.items():
        kind = by_channel[names[0]][case_id]["kind"]
        cells = [
            f"{by_channel[n][case_id]['precision']:.2f} / {by_channel[n][case_id]['r_precision']:.2f}" for n in names
        ]
        lines.append(f"| {case_id} | {kind} | {relevant} | " + " | ".join(cells) + " |")
    lines.append("\n| channel | gating cases | mean P@10 | mean R-prec | mean MRR |")
    lines.append("|---|---|---|---|---|")
    for name in names:
        summary = evaluation.mean_hard([evaluation.HardCaseScore(**row) for row in hard[name]], gating_only=True)
        lines.append(
            f"| {name} | {summary['cases']} | {summary['precision']:.3f} | {summary['r_precision']:.3f} | "
            f"{summary['mrr']:.3f} |"
        )
    lines.append(
        f"| reference ({reference['label']}) | {reference.get('cases', '–')} | "
        f"{_fmt(reference.get('precision', '–'))} | {_fmt(reference['r_precision'])} | "
        f"{_fmt(reference.get('mrr', '–'))} |"
    )


def _reference_note(report: dict[str, Any]) -> str:
    note = f"Reference rows: the Chroma path, {report.get('reference', baseline.SOURCE)}."
    if report["embedder"]["name"] != "production" or report["corpus"]["dimension"] != dimension.FULL:
        note += " This run is not on the production embedder, so they describe another corpus: read them as labels."
    return note


def _scores_row(label: str, s: dict[str, Any], subset: str) -> str:
    recall = s["recall"]
    return (
        f"| {label} | {subset} ({s['queries']}) | {_fmt(recall['10'])} | {_fmt(recall['16'])} | "
        f"{_fmt(recall['60'])} | {_fmt(s['ndcg']['10'])} | {_fmt(s['mrr'])} |"
    )


def render_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    _environment_section(lines, report)
    _lexical_section(lines, report)
    _exact_section(lines, report)
    _hybrid_section(lines, report)
    _dimension_section(lines, report)
    if report.get("variants"):
        lines.append("")
        lines.extend(variants.render(report["variants"]))
    _verdicts_section(lines, report)
    return "\n".join(lines) + "\n"


def _environment_section(lines: list[str], report: dict[str, Any]) -> None:
    env = report.get("environment", {})
    lines.append("## Environment\n")
    lines.append(
        f"Corpus: {report['corpus']['chunks']} chunks ({report['corpus']['allowed_chunks']} after the base filter), "
        f"{report['corpus']['files']} files, {report['corpus']['dimension']}-d vectors from "
        f"`{report['embedder']['model']}` ({report['embedder']['embedded_this_run']} texts embedded this run). "
        f"Qdrant {report['corpus'].get('qdrant_count')} points."
    )
    lines.append(
        f"Machine: {env.get('cpu', '?')}, {env.get('cpus')} CPUs, Python {env.get('python')}; "
        f"Qdrant {env.get('qdrant')} at {env.get('qdrant_url')}. Qdrant index: {report.get('qdrant_index')}.\n"
    )
    lines.append(_reference_note(report) + "\n")


def _lexical_section(lines: list[str], report: dict[str, Any]) -> None:
    lexical = report["lexical"]
    lines.append("## G1b lexical: German golden questions (units, base filter)\n")
    lines.append("| channel | recall@5 | recall@10 | recall@16 | nDCG@10 | MRR | no result |")
    lines.append("|---|---|---|---|---|---|---|")
    rows = [
        (name, scores, _fmt(lexical["golden"][name + ":empty"]))
        for name, scores in lexical["golden"].items()
        if not name.endswith(":empty")
    ]
    rows.append(("reference (Postgres `german` FTS)", baseline.LEXICAL_GOLDEN.as_dict(), "–"))
    for name, scores, empty in rows:
        lines.append(
            f"| {name} | {_fmt(scores['recall']['5'])} | {_fmt(scores['recall']['10'])} | "
            f"{_fmt(scores['recall']['16'])} | {_fmt(scores['ndcg']['10'])} | {_fmt(scores['mrr'])} | {empty} |"
        )
    lines.append("\n## G1b lexical: hard cases (chunk oracle), the lexical channel alone\n")
    _hard_tables(lines, lexical["hard"], lexical["relevant_counts"], {"label": "Postgres FTS", **baseline.LEXICAL_HARD})
    if "hybrid_hard" in report:
        lines.append(f"\n## Hard cases through the full retrieval (depth {HYBRID_DEPTH})\n")
        _hard_tables(
            lines,
            {"qdrant": report["hybrid_hard"]},
            lexical["relevant_counts"],
            {"label": "Chroma path", "r_precision": baseline.HYBRID_HARD_R_PRECISION},
        )


def _exact_section(lines: list[str], report: dict[str, Any]) -> None:
    lines.append("\n## Exact mode: Qdrant `find_text` vs a full regex scan vs the phrase index alone\n")
    lines.append("| phrase | full scan | find_text | identical | phrase index | index misses | index extra |")
    lines.append("|---|---|---|---|---|---|---|")
    for row in report["exact"]:
        lines.append(
            f"| `{row['phrase']}` | {row['regex_scan']} | {row['qdrant_find_text']} | "
            f"{'yes' if row['identical'] else 'NO'} | {row['phrase_index']} | {row['phrase_index_misses']} | "
            f"{row['phrase_index_extra']} |"
        )


def _hybrid_section(lines: list[str], report: dict[str, Any]) -> None:
    hybrid = report["hybrid"]
    lines.append(f"\n## Hybrid: per-collection retrieval at depth {HYBRID_DEPTH} (Punkt golden, units)\n")
    lines.append("| path | set | recall@10 | recall@16 | recall@60 | nDCG@10 | MRR |")
    lines.append("|---|---|---|---|---|---|---|")
    for subset in ("golden_all", "golden_de", "golden_en"):
        label = subset.removeprefix("golden_")
        lines.append(_scores_row("qdrant", hybrid[subset], label))
        lines.append(_scores_row("reference (Chroma)", baseline.HYBRID[subset].as_dict(), label))
    lines.append("\n| path | cohort | recall@16 (files) | recall, whole pool (files) | MRR |")
    lines.append("|---|---|---|---|---|")
    for cohort, s in hybrid["overview"].items():
        lines.append(
            f"| qdrant | {cohort} ({s['queries']}) | {_fmt(s['recall@16'])} | {_fmt(s['recall_pool'])} | "
            f"{_fmt(s['mrr'])} |"
        )
    for cohort, s in baseline.OVERVIEW.items():
        lines.append(
            f"| reference (Chroma) | {cohort} | {_fmt(s['recall@16'])} | {_fmt(s['recall_pool'])} | {_fmt(s['mrr'])} |"
        )
    lines.append("\n## G2 latency: store call per collection, embedding excluded (ms)\n")
    lines.append("| path | n | p50 | p95 | p99 | mean |")
    lines.append("|---|---|---|---|---|---|")
    for name, s in (("qdrant", hybrid["latency_ms"]), ("reference (Chroma + Postgres)", baseline.LATENCY_MS)):
        lines.append(f"| {name} | {s['n']} | {s['p50']} | {s['p95']} | {s['p99']} | {s['mean']} |")


def _dimension_section(lines: list[str], report: dict[str, Any]) -> None:
    dim = report.get("dimension")
    if not dim:
        return
    lines.append(f"\n## G6 dimension: dense channel, Punkt golden ({dim['dimension']} vs {dim['reduced']})\n")
    lines.append("| variant | recall@1 | recall@3 | recall@5 | recall@10 | recall@16 | nDCG@10 | MRR |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for key, value in dim.items():
        if isinstance(value, dict) and "recall" in value:
            cells = [_fmt(value["recall"][k]) for k in ("1", "3", "5", "10", "16")]
            cells += [_fmt(value["ndcg"]["10"]), _fmt(value["mrr"])]
            lines.append(f"| {key} | " + " | ".join(cells) + " |")
    if "qdrant_index" in dim:
        lines.append(f"\nG6 collection index state: {dim['qdrant_index']}")


def _verdicts_section(lines: list[str], report: dict[str, Any]) -> None:
    lines.append("\n## Verdicts\n")
    lines.append("| gate | status | detail |")
    lines.append("|---|---|---|")
    for verdict in report["verdicts"]:
        lines.append(f"| {verdict['gate']} | {verdict['status']} | {verdict['detail']} |")
