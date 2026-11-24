from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy import text

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "conversation_context_gate.py"


def _gate():
    spec = importlib.util.spec_from_file_location("conversation_context_gate", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _db(path: Path, ddl: str, rows: list[str]) -> str:
    url = f"sqlite:///{path}"
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text(ddl))
        for row in rows:
            conn.execute(text(row))
    engine.dispose()
    return url


def _dbs(tmp_path: Path, runs: list[str], jobs: list[str]) -> tuple[str, str]:
    app = _db(
        tmp_path / "app.db",
        "CREATE TABLE task_runs (id TEXT, organization_id TEXT, status TEXT, created_at TEXT)",
        runs,
    )
    job = _db(tmp_path / "jobs.db", "CREATE TABLE job_info (job_id TEXT, status TEXT, created_at TEXT)", jobs)
    return app, job


def test_the_gate_holds_when_nothing_from_before_it_is_still_active(tmp_path, capsys):
    app, job = _dbs(
        tmp_path,
        [
            "INSERT INTO task_runs VALUES ('r_old_done', 'org_1', 'succeeded', '2026-11-20 10:00:00')",
            "INSERT INTO task_runs VALUES ('r_new', 'org_1', 'running', '2026-11-26 10:00:00')",
        ],
        ["INSERT INTO job_info VALUES ('j_old_done', 'success', '2026-11-20 10:00:00')"],
    )
    assert _gate().main(["--since", "2026-11-25T00:00:00", "--app-db-url", app, "--job-db-url", job]) == 0
    assert "gate holds" in capsys.readouterr().out


def test_the_gate_does_not_hold_while_an_old_run_or_queued_job_is_active(tmp_path, capsys):
    app, job = _dbs(
        tmp_path,
        ["INSERT INTO task_runs VALUES ('r_old', 'org_1', 'running', '2026-11-20 10:00:00')"],
        ["INSERT INTO job_info VALUES ('j_old', 'submitted', '2026-11-20 10:00:00')"],
    )
    assert _gate().main(["--since", "2026-11-25T00:00:00", "--app-db-url", app, "--job-db-url", job]) == 1
    out = capsys.readouterr().out
    assert "r_old" in out and "j_old" in out and "1 run(s), 1 job(s)" in out


def test_a_deployed_dsn_is_read_through_the_sync_driver():
    gate = _gate()
    assert gate.sync_url("postgresql+asyncpg://u:p@h/app") == "postgresql+psycopg://u:p@h/app"
    assert gate.sync_url("postgresql://u:p@h/jobs") == "postgresql+psycopg://u:p@h/jobs"
    assert gate.sync_url("postgres://u@h/jobs") == "postgresql+psycopg://u@h/jobs"
    assert gate.sync_url("sqlite:///x.db") == "sqlite:///x.db"


def test_an_asyncpg_ssl_option_becomes_the_libpq_one():
    gate = _gate()
    deployed = "postgresql+asyncpg://u:p@h:5432/jobs?ssl=require&application_name=gate"
    assert gate.sync_url(deployed) == "postgresql+psycopg://u:p@h:5432/jobs?sslmode=require&application_name=gate"
    assert (
        gate.sync_url("postgresql://u@h/app?sslmode=verify-full") == "postgresql+psycopg://u@h/app?sslmode=verify-full"
    )


def test_a_since_without_a_zone_is_utc():
    from datetime import UTC

    assert _gate().since_utc("2026-11-25T00:00:00").tzinfo is UTC
    assert _gate().since_utc("2026-11-25T01:00:00+01:00").utcoffset().total_seconds() == 3600
