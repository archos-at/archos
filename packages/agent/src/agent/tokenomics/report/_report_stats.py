from __future__ import annotations

import csv
from pathlib import Path


def _pct(data: list, p: float) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _latency_stats(durations_s: list[float]) -> dict:
    if not durations_s:
        return {"count": 0, "p50_ms": 0.0, "p90_ms": 0.0, "p99_ms": 0.0, "max_ms": 0.0, "mean_ms": 0.0}
    ms = [d * 1000.0 for d in durations_s]
    return {
        "count": len(ms),
        "p50_ms": round(_pct(ms, 50), 2),
        "p90_ms": round(_pct(ms, 90), 2),
        "p99_ms": round(_pct(ms, 99), 2),
        "max_ms": round(max(ms), 2),
        "mean_ms": round(sum(ms) / len(ms), 2),
    }


def _load_csv_predictions(trace_path: str) -> dict[str, float]:
    csv_path = Path(trace_path).parent / "standardized_data_all.csv"
    if not csv_path.exists():
        return {}
    predictions: dict[str, float] = {}
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("event_type") == "LLM_START" and row.get("NOVA-Predicted-OSL") and row.get("UUID"):
                try:
                    predictions[row["UUID"]] = float(row["NOVA-Predicted-OSL"])
                except ValueError:
                    pass
    return predictions
