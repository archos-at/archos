#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy import text

ACTIVE_RUNS = text(
    "SELECT id, organization_id, status, created_at FROM task_runs "
    "WHERE status IN ('queued', 'running') AND created_at < :since ORDER BY created_at"
)
ACTIVE_JOBS = text(
    "SELECT job_id, status, created_at FROM job_info "
    "WHERE status IN ('submitted', 'running') AND created_at < :since ORDER BY created_at"
)


SYNC_DRIVER = "postgresql+psycopg"
POSTGRES_SCHEMES = ("postgresql+asyncpg", "postgresql+psycopg2", "postgresql", "postgres")


def sync_url(url: str) -> str:
    scheme, separator, rest = url.partition("://")
    if not separator or scheme not in POSTGRES_SCHEMES:
        return url
    location, mark, query = rest.partition("?")
    if scheme == "postgresql+asyncpg" and mark:
        query = "&".join("sslmode" + part[3:] if part.startswith("ssl=") else part for part in query.split("&"))
    return f"{SYNC_DRIVER}://{location}{mark}{query}"


def since_utc(value: str) -> datetime:
    since = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return since if since.tzinfo else since.replace(tzinfo=UTC)


def rows(url: str, query, since: datetime) -> list[tuple]:
    engine = create_engine(sync_url(url))
    try:
        with engine.connect() as conn:
            return [tuple(row) for row in conn.execute(query, {"since": since})]
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Whether slice 3b of the conversation context (ADR-0194) may deploy: "
            "exit 0 when nothing from before slice 2 is still active"
        )
    )
    parser.add_argument(
        "--since", required=True, help="when slice 2 (#1906) was deployed, ISO 8601; UTC unless it names a zone"
    )
    parser.add_argument(
        "--app-db-url",
        default=os.environ.get("APP_MIGRATION_DATABASE_URL"),
        help="the app database as its owner: the runtime role sees no task_runs row under RLS",
    )
    parser.add_argument("--job-db-url", default=os.environ.get("NAT_JOB_STORE_DB_URL"))
    args = parser.parse_args(argv)
    if not args.app_db_url or not args.job_db_url:
        parser.error("both database URLs are required (APP_MIGRATION_DATABASE_URL, NAT_JOB_STORE_DB_URL)")
    since = since_utc(args.since)

    runs = rows(args.app_db_url, ACTIVE_RUNS, since)
    jobs = rows(args.job_db_url, ACTIVE_JOBS, since)
    for run in runs:
        print("active run from before the gate:", *run)
    for job in jobs:
        print("queued or running job from before the gate:", *job)
    holds = not runs and not jobs
    print("gate holds" if holds else f"gate does not hold: {len(runs)} run(s), {len(jobs)} job(s)")
    return 0 if holds else 1


if __name__ == "__main__":
    sys.exit(main())
