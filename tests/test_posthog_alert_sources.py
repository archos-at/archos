"""Each PostHog alert query reads one cluster: `events` or `posthog.metrics`.

PostHog keeps events and metrics on different ClickHouse clusters. A query
over both is refused ("Cannot query tables from different clusters"), and the
scheduled alert check errors and switches the alert off, silencing every rule
in it. Product incidents went dark that way on 2026-11-14 (deploy/posthog/README.md).
"""

import re
from pathlib import Path

ALERTS = Path(__file__).resolve().parent.parent / "deploy" / "posthog" / "alerts"

EVENTS = re.compile(r"\bFROM\s+events\b", re.IGNORECASE)
METRICS = re.compile(r"\bposthog\.(metrics|metric_series)\b", re.IGNORECASE)


def _code(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def test_there_are_alert_queries() -> None:
    assert sorted(ALERTS.glob("*.sql")), f"no alert queries under {ALERTS}"


def test_no_alert_query_reads_events_and_metrics_together() -> None:
    mixed = [
        path.name
        for path in sorted(ALERTS.glob("*.sql"))
        if EVENTS.search(_code(path.read_text())) and METRICS.search(_code(path.read_text()))
    ]
    assert not mixed, (
        f"{mixed} read `events` and `posthog.metrics` in one query; PostHog refuses it and "
        "switches the alert off. Put metric rules in infrastructure-incidents.sql."
    )
