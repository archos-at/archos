from __future__ import annotations

import logging
import threading
import time
import weakref
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any

from opentelemetry import metrics
from opentelemetry.metrics import CallbackOptions
from opentelemetry.metrics import Observation
from sqlalchemy import bindparam
from sqlalchemy import text

from agent.common.claim_queue_schema import ensure_status_guard
from agent.common.claim_queue_schema import upgrade_columns
from agent.common.db_utils import lock_schema
from agent.common.db_utils import present_indexes

logger = logging.getLogger(__name__)

QUEUED = "queued"
CLAIMED = "claimed"
DEAD = "dead"
CANCELLED = "cancelled"

RETIRED = (DEAD, CANCELLED)

STATUSES = (QUEUED, CLAIMED, DEAD, CANCELLED)

PRIORITY_INTERACTIVE = 0
PRIORITY_BULK = 1
PRIORITIES = {"interactive": PRIORITY_INTERACTIVE, "bulk": PRIORITY_BULK}
DEFAULT_PRIORITY = "interactive"

NO_LANE = ""

REASON_ATTEMPTS_EXHAUSTED = "attempts_exhausted"

_PG_LANES_PER_CLAIM = 4

_SQLITE_TIME = "%Y-%m-%d %H:%M:%S"


def priority_rank(name: str | None) -> int:
    if name is None:
        return PRIORITY_INTERACTIVE
    try:
        return PRIORITIES[name]
    except KeyError:
        raise ValueError(f"unknown priority {name!r}; use one of {sorted(PRIORITIES)}") from None


@dataclass(frozen=True)
class Claim:
    job_id: str
    lane: str
    payload: str
    attempts: int
    priority: int = PRIORITY_INTERACTIVE




class _Instruments:

    def __init__(self, meter: metrics.Meter) -> None:
        self._queues: weakref.WeakSet[ClaimQueue] = weakref.WeakSet()
        self.claim_latency = meter.create_histogram(
            "grid.queue.claim_latency_ms", unit="ms", description="Time one claim round trip took"
        )
        self.job_duration = meter.create_histogram(
            "grid.queue.job_duration_seconds", unit="s", description="Time a claimed job took to run"
        )
        self.dead = meter.create_counter("grid.queue.dead_total", description="Jobs moved to dead")
        meter.create_observable_gauge(
            "grid.queue.depth", callbacks=[self._observe_depth], description="Rows in the queue by status"
        )
        meter.create_observable_gauge(
            "grid.queue.oldest_age_seconds",
            callbacks=[self._observe_oldest],
            unit="s",
            description="Age of the oldest queued job",
        )

    def watch(self, queue: ClaimQueue) -> None:
        self._queues.add(queue)

    def _observe_depth(self, _options: CallbackOptions) -> list[Observation]:
        observations: list[Observation] = []
        for queue in list(self._queues):
            counts = queue.counts_or_none()
            if counts is None:
                continue
            for status in STATUSES:
                observations.append(Observation(counts.get(status, 0), {"queue": queue.name, "status": status}))
        return observations

    def _observe_oldest(self, _options: CallbackOptions) -> list[Observation]:
        observations: list[Observation] = []
        for queue in list(self._queues):
            age = queue.oldest_queued_age_or_none()
            if age is not None:
                observations.append(Observation(age, {"queue": queue.name}))
        return observations


_instruments: _Instruments | None = None
_instruments_lock = threading.Lock()


def instruments() -> _Instruments:
    global _instruments
    with _instruments_lock:
        if _instruments is None:
            _instruments = _Instruments(metrics.get_meter("agent.claim_queue"))
        return _instruments




class ClaimQueue:

    def __init__(
        self,
        *,
        name: str,
        table: str,
        turns_table: str,
        db_url: Callable[[], str | None],
        engine_for: Callable[[str], Any],
        reap_lock_id: int,
    ) -> None:
        self.name = name
        self.table = table
        self.turns_table = turns_table
        self._db_url = db_url
        self._engine_for = engine_for
        self._reap_lock_id = reap_lock_id
        self.initialized: set[str] = set()
        self._claim_sql = self._build_pg_claim()


    def ensure_table(self, url: str, conn=None) -> None:
        if url in self.initialized:
            return
        if conn is not None:
            self._ensure_on(conn, url)
            return
        with self._engine_for(url).connect() as own:
            self._ensure_on(own, url)
            own.commit()
        self.mark_ensured(url)

    def mark_ensured(self, url: str) -> None:
        self.initialized.add(url)

    def _ensure_on(self, conn, url: str) -> None:
        postgres = _is_postgres(url)
        ts = "TIMESTAMP WITH TIME ZONE" if postgres else "DATETIME"
        now = "NOW()" if postgres else "CURRENT_TIMESTAMP"
        t = self.table
        lock_schema(conn, t)
        statements = [
            f"CREATE TABLE IF NOT EXISTS {t} ("
            "  job_id VARCHAR PRIMARY KEY,"
            f"  lane VARCHAR NOT NULL DEFAULT '{NO_LANE}',"
            "  payload TEXT NOT NULL,"
            f"  status VARCHAR NOT NULL DEFAULT '{QUEUED}',"
            "  claimed_by VARCHAR,"
            f"  claimed_at {ts},"
            f"  heartbeat_at {ts},"
            "  attempts INTEGER NOT NULL DEFAULT 0,"
            f"  priority INTEGER NOT NULL DEFAULT {PRIORITY_INTERACTIVE},"
            f"  dead_at {ts},"
            "  dead_reason TEXT,"
            f"  cancelled_at {ts},"
            f"  created_at {ts} DEFAULT {now}"
            ")",
            f"CREATE TABLE IF NOT EXISTS {self.turns_table} (lane VARCHAR PRIMARY KEY, last_claimed_at {ts})",
        ]
        for statement in statements:
            _execute_constant(conn, statement)
        self._add_missing_columns(conn, ts)
        ensure_status_guard(conn, t, born=QUEUED, live=(QUEUED, CLAIMED), retired=RETIRED)
        # CREATE INDEX IF NOT EXISTS takes a SHARE lock before checking the name; run on every start it wedged the queue (2026-10-11).
        present = present_indexes(conn, t)
        for name, columns in (
            (f"ix_{t}_status_created", "status, created_at"),
            (f"ix_{t}_status_lane_created", "status, lane, created_at"),
            (f"ix_{t}_lane_priority_created", "lane, priority, created_at"),
        ):
            if name not in present:
                _execute_constant(conn, f"CREATE INDEX IF NOT EXISTS {name} ON {t} ({columns})")
        if f"ix_{t}_lane_created" in present:
            _execute_constant(conn, f"DROP INDEX IF EXISTS ix_{t}_lane_created")

    def _add_missing_columns(self, conn, ts: str) -> None:
        wanted = {
            "lane": f"VARCHAR NOT NULL DEFAULT '{NO_LANE}'",
            "priority": f"INTEGER NOT NULL DEFAULT {PRIORITY_INTERACTIVE}",
            "dead_at": ts,
            "dead_reason": "TEXT",
            "cancelled_at": ts,
        }
        upgrade_columns(conn, self.table, wanted, postgres="WITH TIME ZONE" in ts)


    def enqueue(self, job_id: str, lane: str, payload: str, priority: str | None = None) -> bool:
        url = self._db_url()
        if not url:
            raise RuntimeError(f"no database for the {self.name} queue")
        rank = priority_rank(priority)
        self.ensure_table(url)
        with self._engine_for(url).connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"INSERT INTO {self.table} (job_id, lane, payload, status, attempts, priority) "
                    "VALUES (:id, :lane, :payload, :q, 0, :priority) ON CONFLICT (job_id) DO NOTHING"
                ),
                {"id": job_id, "lane": lane, "payload": payload, "q": QUEUED, "priority": rank},
            )
            conn.commit()
        return (result.rowcount or 0) > 0


    def _runnable(self) -> str:
        return (
            "(q.status = :queued OR (q.status = :claimed AND q.attempts < :max_attempts "
            "AND q.heartbeat_at < NOW() - make_interval(secs => :stale)))"
        )

    def _build_pg_claim(self) -> str:
        t, turns, runnable = self.table, self.turns_table, self._runnable()
        return f"""
WITH running AS (
    SELECT lane, COUNT(*) AS n FROM {t}
    WHERE status = :claimed AND heartbeat_at >= NOW() - make_interval(secs => :stale)
    GROUP BY lane
),
lanes AS (
    SELECT w.lane, COALESCE(r.n, 0) AS n, t.last_claimed_at, w.oldest
    FROM (SELECT q.lane, MIN(q.created_at) AS oldest FROM {t} q WHERE {runnable} GROUP BY q.lane) w
    LEFT JOIN running r ON r.lane = w.lane
    LEFT JOIN {turns} t ON t.lane = w.lane
    WHERE (:cap = 0 OR COALESCE(r.n, 0) < :cap)
    ORDER BY COALESCE(r.n, 0), t.last_claimed_at NULLS FIRST, w.oldest, w.lane COLLATE "C"
    LIMIT {_PG_LANES_PER_CLAIM}
),
candidate AS (
    SELECT pick.job_id FROM lanes
    CROSS JOIN LATERAL (
        SELECT q.job_id FROM {t} q
        WHERE q.lane = lanes.lane AND {runnable}
        ORDER BY q.priority, q.created_at, q.job_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    ) pick
    ORDER BY lanes.n, lanes.last_claimed_at NULLS FIRST, lanes.oldest, lanes.lane COLLATE "C"
    LIMIT 1
),
claimed AS (
    UPDATE {t} q
    SET status = :claimed, claimed_by = :worker, claimed_at = NOW(), heartbeat_at = NOW(),
        attempts = q.attempts + 1
    FROM candidate WHERE q.job_id = candidate.job_id
    RETURNING q.job_id, q.lane, q.payload, q.attempts, q.priority
),
turn AS (
    INSERT INTO {turns} (lane, last_claimed_at)
    SELECT lane, NOW() FROM claimed
    ON CONFLICT (lane) DO UPDATE SET last_claimed_at = EXCLUDED.last_claimed_at
)
SELECT job_id, lane, payload, attempts, priority FROM claimed
"""

    def claim_next(self, worker: str, *, stale_seconds: int, max_attempts: int, per_lane_cap: int = 0) -> Claim | None:
        url = self._db_url()
        if not url:
            return None
        self.ensure_table(url)
        params = {
            "worker": worker,
            "stale": stale_seconds,
            "max_attempts": max_attempts,
            "cap": max(0, per_lane_cap),
            "queued": QUEUED,
            "claimed": CLAIMED,
        }
        started = time.monotonic()
        with self._engine_for(url).connect() as conn:
            if _is_postgres(url):
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                row = conn.execute(text(self._claim_sql), params).first()
            else:
                row = self._claim_sqlite(conn, params)
            conn.commit()
            instruments().claim_latency.record((time.monotonic() - started) * 1000, {"queue": self.name})
            if row is None:
                return None
            if params["cap"] and self._release_over_cap(conn, url, row, params):
                return None
        return Claim(job_id=row[0], lane=row[1], payload=row[2], attempts=row[3], priority=row[4])

    def _release_over_cap(self, conn, url: str, row, params: dict) -> bool:
        job_id, lane = row[0], row[1]
        if _is_postgres(url):
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lane))"), {"lane": f"{self.table}-cap:{lane}"})
            fresh = "heartbeat_at >= NOW() - make_interval(secs => :stale)"
        else:
            fresh = "heartbeat_at >= :threshold"
        others = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT COUNT(*) FROM {self.table} "
                f"WHERE lane = :lane AND status = :claimed AND {fresh} AND job_id <> :id"
            ),
            {
                "lane": lane,
                "claimed": CLAIMED,
                "stale": params["stale"],
                "threshold": _sqlite_threshold(params["stale"]),
                "id": job_id,
            },
        ).scalar()
        if int(others or 0) < params["cap"]:
            conn.commit()
            return False
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {self.table} SET status = :queued, claimed_by = NULL, claimed_at = NULL, "
                "heartbeat_at = NULL, attempts = attempts - 1 WHERE job_id = :id AND claimed_by = :worker"
            ),
            {"queued": QUEUED, "id": job_id, "worker": params["worker"]},
        )
        conn.commit()
        logger.info(
            "%s lane %s was at its cap of %d; job %s goes back to the queue", self.name, lane, params["cap"], job_id
        )
        return True

    def _claim_sqlite(self, conn, params: dict):
        now = datetime.now(UTC).replace(tzinfo=None)
        threshold = _sqlite_threshold(params["stale"])
        t = self.table
        running = dict(
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT lane, COUNT(*) FROM {t} WHERE status = :claimed AND heartbeat_at >= :t GROUP BY lane"),
                {"claimed": CLAIMED, "t": threshold},
            ).all()
        )
        turns = dict(
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT lane, last_claimed_at FROM {self.turns_table}")
            ).all()
        )
        rows = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                "SELECT job_id, lane, payload, attempts, priority, oldest FROM ("
                "  SELECT job_id, lane, payload, attempts, priority, "
                "         MIN(created_at) OVER (PARTITION BY lane) AS oldest, "
                "         ROW_NUMBER() OVER (PARTITION BY lane ORDER BY priority, created_at, job_id) AS rn "
                f"  FROM {t} "
                "  WHERE status = :queued OR (status = :claimed AND attempts < :max_attempts AND heartbeat_at < :t)"
                ") WHERE rn = 1"
            ),
            {**params, "t": threshold},
        ).all()
        best = _fairest_lane_head(rows, running, turns, params["cap"])
        if best is None:
            return None
        stamp = now.strftime("%Y-%m-%d %H:%M:%S.%f")
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {t} SET status = :claimed, claimed_by = :worker, claimed_at = :now, "
                "heartbeat_at = :now, attempts = attempts + 1 WHERE job_id = :id"
            ),
            {"claimed": CLAIMED, "worker": params["worker"], "now": stamp, "id": best[0]},
        )
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"INSERT INTO {self.turns_table} (lane, last_claimed_at) VALUES (:lane, :now) "
                "ON CONFLICT (lane) DO UPDATE SET last_claimed_at = excluded.last_claimed_at"
            ),
            {"lane": best[1], "now": stamp},
        )
        return (best[0], best[1], best[2], best[3] + 1, best[4])


    def heartbeat(self, job_id: str, worker: str) -> bool:
        url = self._db_url()
        if not url:
            return False
        now = "NOW()" if _is_postgres(url) else "CURRENT_TIMESTAMP"
        with self._engine_for(url).connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {self.table} SET heartbeat_at = {now} "
                    "WHERE job_id = :id AND claimed_by = :worker AND status = :claimed"
                ),
                {"id": job_id, "worker": worker, "claimed": CLAIMED},
            )
            conn.commit()
        return (result.rowcount or 0) > 0

    def mark_done(self, job_id: str, worker: str | None = None) -> None:
        url = self._db_url()
        if not url:
            return
        sql = f"DELETE FROM {self.table} WHERE job_id = :id"
        params: dict = {"id": job_id}
        if worker is not None:
            sql += " AND claimed_by = :worker AND status = :claimed"
            params["worker"] = worker
            params["claimed"] = CLAIMED
        with self._engine_for(url).connect() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            conn.execute(text(sql), params)
            conn.commit()

    def release_claims(self, job_ids: list[str], worker: str) -> int:
        url = self._db_url()
        if not url or not job_ids:
            return 0
        self.ensure_table(url)
        with self._engine_for(url).connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {self.table} SET status = :queued, claimed_by = NULL, claimed_at = NULL, "
                    "heartbeat_at = NULL, attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END "
                    "WHERE job_id IN :ids AND claimed_by = :worker AND status = :claimed"
                ).bindparams(bindparam("ids", expanding=True)),
                {"queued": QUEUED, "claimed": CLAIMED, "worker": worker, "ids": list(job_ids)},
            )
            conn.commit()
        released = result.rowcount or 0
        if released:
            logger.info("%s: %d claim(s) of %s released without an attempt", self.name, released, worker)
        return released

    def cancel(self, job_id: str) -> str | None:
        url = self._db_url()
        if not url:
            return None
        self.ensure_table(url)
        now = "NOW()" if _is_postgres(url) else "CURRENT_TIMESTAMP"
        with self._engine_for(url).connect() as conn:
            prior = next((live for live in (QUEUED, CLAIMED) if self._cancel_if(conn, job_id, live, now)), None)
        if prior is None:
            return None
        logger.info("%s: job %s cancelled (was %s)", self.name, job_id, prior)
        return prior

    def _cancel_if(self, conn: Any, job_id: str, live: str, now: str) -> bool:
        result = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {self.table} SET status = :cancelled, cancelled_at = {now}, payload = '' "
                "WHERE job_id = :id AND status = :live"
            ),
            {"cancelled": CANCELLED, "live": live, "id": job_id},
        )
        conn.commit()
        return bool(result.rowcount)

    def status_of(self, job_id: str) -> str | None:
        url = self._db_url()
        if not url:
            return None
        self.ensure_table(url)
        with self._engine_for(url).connect() as conn:
            row = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT status FROM {self.table} WHERE job_id = :id"),
                {"id": job_id},
            ).scalar()
        return str(row) if row is not None else None

    def mark_dead(self, job_id: str, reason: str) -> bool:
        url = self._db_url()
        if not url:
            return False
        self.ensure_table(url)
        now = "NOW()" if _is_postgres(url) else "CURRENT_TIMESTAMP"
        with self._engine_for(url).connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {self.table} SET status = :dead, dead_at = {now}, dead_reason = :reason, payload = '' "
                    "WHERE job_id = :id AND status NOT IN (:dead, :cancelled)"
                ),
                {"dead": DEAD, "cancelled": CANCELLED, "reason": reason, "id": job_id},
            )
            conn.commit()
        retired = (result.rowcount or 0) > 0
        if retired:
            instruments().dead.add(1, {"queue": self.name})
        return retired

    def reap_exhausted(self, *, stale_seconds: int, max_attempts: int) -> list[str]:
        url = self._db_url()
        if not url:
            return []
        self.ensure_table(url)
        postgres = _is_postgres(url)
        stale = "heartbeat_at < NOW() - make_interval(secs => :stale)" if postgres else "heartbeat_at < :threshold"
        now = "NOW()" if postgres else "CURRENT_TIMESTAMP"
        params = {
            "stale": stale_seconds,
            "threshold": _sqlite_threshold(stale_seconds),
            "claimed": CLAIMED,
            "dead": DEAD,
            "reason": REASON_ATTEMPTS_EXHAUSTED,
            "max_attempts": max_attempts,
        }
        with self._engine_for(url).connect() as conn:
            if (
                postgres
                and not conn.execute(text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": self._reap_lock_id}).scalar()
            ):
                conn.commit()
                return []
            ids = list(
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        f"UPDATE {self.table} SET status = :dead, dead_at = {now}, dead_reason = :reason, "
                        "payload = '' "
                        f"WHERE status = :claimed AND attempts >= :max_attempts AND {stale} RETURNING job_id"
                    ),
                    params,
                ).scalars()
            )
            conn.commit()
        if ids:
            instruments().dead.add(len(ids), {"queue": self.name})
            logger.error("%s: %d job(s) failed %d claims each and are dead", self.name, len(ids), max_attempts)
        return ids

    def purge_retired(self, *, older_than_seconds: int) -> int:
        url = self._db_url()
        if not url:
            return 0
        self.ensure_table(url)
        if _is_postgres(url):
            cutoff = "COALESCE(cancelled_at, dead_at) < NOW() - make_interval(secs => :age)"
            params: dict = {"age": older_than_seconds}
        else:
            cutoff = "COALESCE(cancelled_at, dead_at) < :threshold"
            params = {"threshold": _sqlite_threshold(older_than_seconds)}
        with self._engine_for(url).connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"DELETE FROM {self.table} WHERE status IN :retired AND {cutoff}").bindparams(
                    bindparam("retired", expanding=True)
                ),
                {**params, "retired": list(RETIRED)},
            )
            conn.commit()
        return result.rowcount or 0


    def counts(self) -> dict[str, int]:
        url = self._db_url()
        counts = dict.fromkeys(STATUSES, 0)
        if not url:
            return counts
        self.ensure_table(url)
        with self._engine_for(url).connect() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            rows = conn.execute(text(f"SELECT status, COUNT(*) FROM {self.table} GROUP BY status")).all()
        counts.update({str(status): int(n) for status, n in rows})
        return counts

    def queued_in_lane(self, lane: str) -> int:
        url = self._db_url()
        if not url:
            return 0
        self.ensure_table(url)
        with self._engine_for(url).connect() as conn:
            waiting = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT COUNT(*) FROM {self.table} WHERE lane = :lane AND status = :q"),
                {"lane": lane, "q": QUEUED},
            ).scalar()
        return int(waiting or 0)

    def oldest_queued_age(self) -> float:
        url = self._db_url()
        if not url:
            return 0.0
        self.ensure_table(url)
        if _is_postgres(url):
            age = "EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))"
        else:
            age = "(julianday('now') - julianday(MIN(created_at))) * 86400.0"
        with self._engine_for(url).connect() as conn:
            value = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT {age} FROM {self.table} WHERE status = :q"),
                {"q": QUEUED},
            ).scalar()
        return max(0.0, float(value or 0))

    def counts_or_none(self) -> dict[str, int] | None:
        try:
            return self.counts()
        except Exception:  # noqa: BLE001 - a metrics callback must never raise into the SDK
            logger.warning("%s: counting queue rows for the depth gauge failed", self.name, exc_info=True)
            return None

    def oldest_queued_age_or_none(self) -> float | None:
        try:
            return self.oldest_queued_age()
        except Exception:  # noqa: BLE001 - as above
            logger.warning("%s: reading the oldest queued age failed", self.name, exc_info=True)
            return None

    def ahead_in_lane(self, job_ids: list[str]) -> dict[str, int]:
        url = self._db_url()
        if not url or not job_ids:
            return {}
        self.ensure_table(url)
        t = self.table
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        query = text(
            f"SELECT q.job_id, (SELECT COUNT(*) FROM {t} o"
            "   WHERE o.status = :q AND o.lane = q.lane"
            "     AND (o.priority < q.priority"
            "          OR (o.priority = q.priority AND (o.created_at < q.created_at"
            "              OR (o.created_at = q.created_at AND o.job_id < q.job_id))))) AS ahead"
            f" FROM {t} q WHERE q.status = :q AND q.job_id IN :ids"
        ).bindparams(bindparam("ids", expanding=True))
        with self._engine_for(url).connect() as conn:
            rows = conn.execute(query, {"q": QUEUED, "ids": list(job_ids)}).all()
        return {str(job_id): int(ahead) for job_id, ahead in rows}


    def observe(self) -> None:
        instruments().watch(self)

    def record_duration(self, seconds: float, kind: str) -> None:
        instruments().job_duration.record(max(0.0, seconds), {"queue": self.name, "kind": kind})




def _is_postgres(url: str) -> bool:
    return url.startswith("postgres")


def _fairest_lane_head(rows, running: dict, turns: dict, cap: int):
    eligible = [r for r in rows if not cap or running.get(r[1], 0) < cap]
    if not eligible:
        return None
    return min(
        eligible,
        key=lambda r: (running.get(r[1], 0), turns.get(r[1]) is not None, turns.get(r[1]) or "", r[5], r[1]),
    )


def _sqlite_threshold(seconds: int) -> str:
    return (datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=seconds)).strftime(_SQLITE_TIME)


def _execute_constant(conn, statement: str) -> None:
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(statement))
