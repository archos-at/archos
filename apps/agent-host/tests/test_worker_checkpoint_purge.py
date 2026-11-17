import inspect

from sqlalchemy import text

from agent_host.jobs import agent_job
from agent_host.jobs.event_store import EventStore
from agent_host.jobs.runner import _purge_deep_checkpoint

_TABLES = ("checkpoints", "checkpoint_blobs", "checkpoint_writes")


def test_purge_deletes_only_the_finished_thread(tmp_path, monkeypatch):
    dsn = f"sqlite:///{tmp_path / 'ckpt.db'}"
    monkeypatch.setenv("DEEP_CHECKPOINT_DB", dsn)
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        for t in _TABLES:
            conn.execute(text(f"CREATE TABLE {t} (thread_id TEXT, v TEXT)"))
            conn.execute(text(f"INSERT INTO {t} (thread_id, v) VALUES ('job-1', 'a'), ('job-2', 'b')"))
        conn.commit()

    _purge_deep_checkpoint("job-1")

    with engine.connect() as conn:
        for t in _TABLES:
            remaining = conn.execute(text(f"SELECT thread_id FROM {t}")).scalars().all()
            assert "job-1" not in remaining, f"{t} still has the finished job's rows"
            assert "job-2" in remaining, f"{t} lost another job's rows"


def test_purge_is_noop_without_dsn(monkeypatch):
    monkeypatch.delenv("DEEP_CHECKPOINT_DB", raising=False)
    _purge_deep_checkpoint("job-x")  # must not raise


def test_purge_swallows_missing_tables(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEP_CHECKPOINT_DB", f"sqlite:///{tmp_path / 'empty.db'}")
    _purge_deep_checkpoint("job-x")


def _checkpoint_db(tmp_path, monkeypatch):
    dsn = f"sqlite:///{tmp_path / 'ckpt.db'}"
    monkeypatch.setenv("DEEP_CHECKPOINT_DB", dsn)
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        for t in _TABLES:
            conn.execute(text(f"CREATE TABLE {t} (thread_id TEXT, v TEXT)"))
            conn.execute(text(f"INSERT INTO {t} (thread_id, v) VALUES ('job-1', 'a')"))
        conn.commit()
    return engine


def _rows_left(engine) -> int:
    with engine.connect() as conn:
        return sum(len(conn.execute(text(f"SELECT thread_id FROM {t}")).all()) for t in _TABLES)


def test_every_run_purges_its_checkpoint_once_terminal():
    source = inspect.getsource(agent_job.run_agent_job)
    assert "_purge_deep_checkpoint, request.job_id" in source
