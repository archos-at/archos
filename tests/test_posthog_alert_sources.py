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


PULUMI = Path(__file__).resolve().parent.parent / "deploy" / "pulumi"
POSTHOG = Path(__file__).resolve().parent.parent / "deploy" / "posthog"


def _app_hosts(stack: str) -> tuple[str, str | None]:
    text = (PULUMI / f"Pulumi.{stack}.yaml").read_text()
    current = re.search(r"^\s*[\w-]+:baseDomain:\s*(\S+)", text, re.MULTILINE)
    former = re.search(r"^\s*[\w-]+:formerBaseDomain:\s*(\S+)", text, re.MULTILINE)
    assert current, f"Pulumi.{stack}.yaml has no baseDomain"
    return f"app.{current.group(1)}", f"app.{former.group(1)}" if former else None


def test_posthog_sql_naming_a_former_app_host_also_names_the_current_one() -> None:
    stale = []
    for stack in ("prod", "dev"):
        current, former = _app_hosts(stack)
        if former is None:
            continue
        stale += [
            f"{path.relative_to(POSTHOG)} names '{former}' but not '{current}'"
            for path in sorted(POSTHOG.rglob("*.sql"))
            if f"'{former}'" in _code(path.read_text()) and f"'{current}'" not in _code(path.read_text())
        ]
    assert not stale, (
        "Since a domain move PostHog records the new host only, so a filter on the former one reads "
        "zero (2026-11-15: production alerts went blind). Match both hosts: " + "; ".join(stale)
    )
