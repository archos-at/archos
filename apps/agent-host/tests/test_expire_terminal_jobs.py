from __future__ import annotations

from datetime import UTC
from datetime import datetime
from datetime import timedelta

from sqlalchemy import text

from agent_host.jobs.access import expire_terminal_jobs
from agent_host.jobs.event_store import EventStore


def _iso(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S")


def _setup(dsn: str) -> None:
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE job_info ("
                "  job_id TEXT PRIMARY KEY, status TEXT, updated_at DATETIME,"
                "  expiry_seconds INTEGER, is_expired INTEGER DEFAULT 0)"
            )
        )
        conn.execute(text("CREATE TABLE job_access (job_id TEXT PRIMARY KEY, owner TEXT)"))
        conn.execute(text("CREATE TABLE job_events (id INTEGER PRIMARY KEY, job_id TEXT)"))
        rows = [
            ("active", "RUNNING", _iso(30), 3600),  # non-terminal -> never touched
            ("old-del", "FAILURE", _iso(30), 3600),  # past expiry + past 7d grace -> DELETE
            ("mid-mark", "FAILURE", _iso(2), 3600),  # past expiry, within grace -> MARK
            ("newest", "SUCCESS", _iso(1), 3600),  # most-recent finished -> KEEP untouched
        ]
        for job_id, status, updated_at, expiry in rows:
            conn.execute(
                text("INSERT INTO job_info (job_id, status, updated_at, expiry_seconds) VALUES (:j, :s, :u, :e)"),
                {"j": job_id, "s": status, "u": updated_at, "e": expiry},
            )
            conn.execute(text("INSERT INTO job_access (job_id, owner) VALUES (:j, 'u')"), {"j": job_id})
            conn.execute(text("INSERT INTO job_events (job_id) VALUES (:j)"), {"j": job_id})
        conn.commit()


def test_marks_expired_deletes_aged_keeps_newest_and_active(tmp_path):
    dsn = f"sqlite:///{tmp_path / 'jobs.db'}"
    _setup(dsn)

    marked, deleted = expire_terminal_jobs(dsn, delete_grace_seconds=7 * 86400)

    assert (marked, deleted) == (2, 1)
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        info = dict(conn.execute(text("SELECT job_id, is_expired FROM job_info")).fetchall())
        assert "old-del" not in info
        for table in ("job_access", "job_events"):
            remaining = conn.execute(text(f"SELECT job_id FROM {table}")).scalars().all()
            assert "old-del" not in remaining, f"{table} kept the deleted job"
        assert info["mid-mark"] == 1
        assert info["newest"] == 0
        assert info["active"] == 0


def test_noop_when_no_job_info_table(tmp_path):
    dsn = f"sqlite:///{tmp_path / 'empty.db'}"
    assert expire_terminal_jobs(dsn, delete_grace_seconds=604800) == (0, 0)


def test_a_grace_shorter_than_the_expiry_never_deletes_a_job_before_it_expires(tmp_path):
    dsn = f"sqlite:///{tmp_path / 'jobs.db'}"
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE job_info ("
                "  job_id TEXT PRIMARY KEY, status TEXT, updated_at DATETIME,"
                "  expiry_seconds INTEGER, is_expired INTEGER DEFAULT 0)"
            )
        )
        conn.execute(text("CREATE TABLE job_access (job_id TEXT PRIMARY KEY, owner TEXT)"))
        conn.execute(text("CREATE TABLE job_events (id INTEGER PRIMARY KEY, job_id TEXT)"))
        for job_id, updated_at in (("long-lived", _iso(2)), ("newest", _iso(0.5))):
            conn.execute(
                text(
                    "INSERT INTO job_info (job_id, status, updated_at, expiry_seconds) VALUES (:j, 'SUCCESS', :u, :e)"
                ),
                {"j": job_id, "u": updated_at, "e": 7 * 86400},
            )
        conn.commit()

    assert expire_terminal_jobs(dsn, delete_grace_seconds=86400) == (0, 0)
