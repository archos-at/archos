from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import datetime
from datetime import timedelta

from . import lease_policy
from . import orchestrator_runs
from . import research_workflow
from .worker import decode_payload

logger = logging.getLogger(__name__)

TABLE = "research_job_queue"
_NO_ORGANIZATION_LANES = ("", research_workflow.PLATFORM_LANE)
_PRIORITY_NAMES = {0: "interactive", 1: "bulk"}
_TERMINAL = ("success", "failure", "interrupted")
DRAIN_ENV = "RESEARCH_WORKER_DRAIN_SECONDS"
CLAIM_MARGIN_SECONDS = 60
BATCH = 500
CUTOVER_EVERY_SECONDS = 60
CUTOVER_QUIET_SECONDS = 3600


@dataclass
class Requeued:
    started: list[str] = field(default_factory=list)
    already_terminal: list[str] = field(default_factory=list)
    already_on_hatchet: list[str] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)
    table_missing: bool = False

    @property
    def removed(self) -> int:
        return len(self.started) + len(self.already_terminal) + len(self.already_on_hatchet)


def claim_age_floor() -> int:
    return lease_policy.int_env(DRAIN_ENV, lease_policy.DRAIN_SECONDS, floor=0) + CLAIM_MARGIN_SECONDS


def _engine(db_url: str):
    from .event_store import EventStore

    return EventStore._get_or_create_sync_engine(db_url)


def _table_exists(db_url: str) -> bool:
    from sqlalchemy import inspect

    return inspect(_engine(db_url)).has_table(TABLE)


def _movable_query(postgres: bool, skip: int, every_claim: bool):
    from sqlalchemy import bindparam
    from sqlalchemy import text

    threshold = "NOW() - make_interval(secs => :age)" if postgres else ":threshold"
    lock = " FOR UPDATE OF q SKIP LOCKED" if postgres else ""
    left = " AND q.job_id NOT IN :skip" if skip else ""
    silent = "TRUE" if every_claim else f"COALESCE(q.heartbeat_at, q.claimed_at, q.created_at) < {threshold}"
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    query = text(
        f"SELECT q.job_id, q.lane, q.payload, q.priority, i.status FROM {TABLE} q "
        "LEFT JOIN job_info i ON i.job_id = q.job_id "
        f"WHERE (q.status = 'queued' OR (q.status = 'claimed' AND {silent})){left} "
        f"ORDER BY q.created_at, q.job_id LIMIT 1{lock}"
    )
    return query.bindparams(bindparam("skip", expanding=True)) if skip else query


def _lock_next(conn, min_claim_age: int, skip: set[str]) -> tuple | None:
    postgres = conn.dialect.name == "postgresql"
    every_claim = min_claim_age <= 0
    params: dict = {}
    if not every_claim:
        params = {"age": min_claim_age} if postgres else {"threshold": _sqlite_threshold(min_claim_age)}
    if skip:
        params["skip"] = sorted(skip)
    row = conn.execute(_movable_query(postgres, len(skip), every_claim), params).first()
    return tuple(row) if row else None


def _sqlite_threshold(min_claim_age: int) -> str:
    return (datetime.now(UTC) - timedelta(seconds=min_claim_age)).strftime("%Y-%m-%d %H:%M:%S")


def _delete_row(conn, job_id: str) -> None:
    from sqlalchemy import text

    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(f"DELETE FROM {TABLE} WHERE job_id = :job_id"), {"job_id": job_id})


async def _settle(db_url: str, row: tuple, result: Requeued) -> bool:
    job_id, lane, stored, priority, status = row
    if status in _TERMINAL:
        result.already_terminal.append(job_id)
        return True
    if await asyncio.to_thread(orchestrator_runs.run_id_for, db_url, job_id):
        result.already_on_hatchet.append(job_id)
        return True
    try:
        payload = decode_payload(stored)
    except Exception:
        logger.error("Job %s: its queued payload cannot be read; left in %s", job_id, TABLE, exc_info=True)
        result.unreadable.append(job_id)
        return False
    organization_id = None if lane in _NO_ORGANIZATION_LANES else lane
    await research_workflow.start(db_url, job_id, payload, organization_id, _PRIORITY_NAMES.get(priority))
    result.started.append(job_id)
    return True


async def move_next(db_url: str, result: Requeued, *, min_claim_age: int, skip: set[str]) -> bool:
    conn = await asyncio.to_thread(_engine(db_url).connect)
    try:
        row = await asyncio.to_thread(_lock_next, conn, min_claim_age, skip)
        if row is None:
            return False
        if await _settle(db_url, row, result):
            await asyncio.to_thread(_delete_row, conn, row[0])
        else:
            skip.add(row[0])
        await asyncio.to_thread(conn.commit)
        return True
    finally:
        await asyncio.to_thread(conn.close)


async def requeue(
    db_url: str, *, min_claim_age: int | None = None, limit: int | None = None, stop: asyncio.Event | None = None
) -> Requeued:
    result = Requeued()
    if not await asyncio.to_thread(_table_exists, db_url):
        result.table_missing = True
        return result
    age = claim_age_floor() if min_claim_age is None else min_claim_age
    skip: set[str] = set()
    seen = 0
    while (limit is None or seen < limit) and not (stop is not None and stop.is_set()):
        if not await move_next(db_url, result, min_claim_age=age, skip=skip):
            break
        seen += 1
    return result


def _live_rows(db_url: str) -> int:
    from sqlalchemy import text

    with _engine(db_url).connect() as conn:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        query = text(f"SELECT COUNT(*) FROM {TABLE} WHERE status IN ('queued', 'claimed')")
        return int(conn.execute(query).scalar_one())


async def cut_over(db_url: str, stop: asyncio.Event) -> bool | None:
    try:
        result = await requeue(db_url, limit=BATCH, stop=stop)
        if result.table_missing:
            return None
        if result.removed:
            logger.info(
                "Research cutover: %d job(s) moved from %s to Hatchet, %d already ended, %d already there",
                len(result.started),
                TABLE,
                len(result.already_terminal),
                len(result.already_on_hatchet),
            )
        waiting = await asyncio.to_thread(_live_rows, db_url) - len(result.unreadable)
    except Exception as error:  # noqa: BLE001 - the payload never reaches a log; the next pass tries again
        logger.warning("Research cutover pass failed (%s); the next one tries again", type(error).__name__)
        return True
    return result.removed > 0 or waiting > 0


async def cutover_loop(
    db_url: str, stop: asyncio.Event, *, every: float = CUTOVER_EVERY_SECONDS, quiet_for: float = CUTOVER_QUIET_SECONDS
) -> None:
    quiet = 0.0
    while quiet < quiet_for:
        busy = await cut_over(db_url, stop)
        if busy is None:
            logger.info("Research cutover: %s is gone; no longer checked", TABLE)
            return
        quiet = 0.0 if busy else quiet + every
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=every)
        if stop.is_set():
            return
    logger.info("Research cutover: %s held no job for %ds; no longer checked", TABLE, int(quiet_for))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Move the old research claim queue's jobs to Hatchet.")
    parser.add_argument(
        "--force", action="store_true", help="move every claim, also a young one: only once every old pod is gone"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    db_url = os.environ.get("NAT_JOB_STORE_DB_URL", "sqlite:///./data/jobs.db")
    result = asyncio.run(requeue(db_url, min_claim_age=0 if args.force else None))
    left = 0 if result.table_missing else _live_rows(db_url)
    print(
        f"started {len(result.started)}, already terminal {len(result.already_terminal)}, "
        f"already on Hatchet {len(result.already_on_hatchet)}, unreadable {len(result.unreadable)}"
        + (f": {', '.join(result.unreadable)}" if result.unreadable else "")
        + f"; {left} left in {TABLE}"
    )


if __name__ == "__main__":
    main()
