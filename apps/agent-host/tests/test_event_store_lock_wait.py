"""Both event-store engines wait 30 s for a SQLite write lock.

With several workers writing one SQLite file (dev, the Hatchet engine suite),
the async engine's default 5 s wait made an event write give up and drop the
event: PR 1477's run 41722028227 lost a run's `test.started` to "database is
locked". The sync engine already waited 30 s; this holds the two together.
"""

from __future__ import annotations

from sqlalchemy import text

from agent_host.jobs.event_store import EventStore


def test_the_sync_engine_waits_for_the_lock(tmp_path):
    engine = EventStore._get_or_create_sync_engine(f"sqlite:///{tmp_path / 'sync.db'}")

    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == 30_000


async def test_the_async_engine_waits_as_long(tmp_path):
    engine = EventStore._get_or_create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'async.db'}")

    async with engine.connect() as connection:
        assert (await connection.execute(text("PRAGMA busy_timeout"))).scalar() == 30_000
    await engine.dispose()
