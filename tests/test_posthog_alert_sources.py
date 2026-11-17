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


def _rules(sql: str) -> list[tuple[str, str]]:
    blocks = re.split(r"\n(?=SELECT\n)", _code(sql))
    labelled = [(re.search(r"'([^']*for 15 min[^']*)'", block), block) for block in blocks]
    return [(label.group(1), block) for label, block in labelled if label]


def _breach(block: str) -> str:
    return block[block.index("toFloat(") :]


def _unguarded(sql: str) -> list[str]:
    code = _code(sql)
    guarded = {name for name, body in re.findall(r"\n(\w+) AS \((.*?)\n\)", code, re.S) if "spans15" in body}
    return [
        label
        for label, block in _rules(sql)
        if "spans15" not in _breach(block)
        and "covered15" not in _breach(block)
        and not set(re.findall(r"\bFROM (\w+)", block)) & guarded
    ]


def test_every_15_minute_rule_needs_a_series_covering_the_window() -> None:
    sql = (ALERTS / "platform-health.sql").read_text()
    guard = re.findall(
        r"minIf\(m\.timestamp, m\.timestamp > now\(\) - INTERVAL 15 MINUTE\) < now\(\) - INTERVAL 12 MINUTE"
        r"\s+AND max\(m\.timestamp\) > now\(\) - INTERVAL 5 MINUTE AS spans15",
        _code(sql),
    )
    assert len(guard) == sql.count("AS lo15,"), "every area reading lo15 defines spans15 over both ends of the window"
    assert _rules(sql), "no rule says 'for 15 min'"
    assert not _unguarded(sql), f"{_unguarded(sql)} fire on a single sample: their breach needs spans15"


def test_a_guard_only_in_the_label_does_not_count() -> None:
    sql = (ALERTS / "platform-health.sql").read_text()
    breach = "toFloat(countIf(spans15 AND hi15 = 0))"
    assert breach in sql
    assert _unguarded(sql.replace(breach, "toFloat(countIf(hi15 = 0))")) == ["Qdrant peer down for 15 min: "]
