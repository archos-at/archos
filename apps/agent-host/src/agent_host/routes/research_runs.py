from __future__ import annotations

import logging
from typing import Any

from ..jobs.access import JobCaller
from ..jobs.access import job_visibility_clause

logger = logging.getLogger(__name__)


def format_created_at(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return value.isoformat()
    except AttributeError:
        return str(value)


def _listing_queries(where_clause: str):
    from sqlalchemy import text

    join_sql = "FROM job_access ja INNER JOIN job_info ji ON ja.job_id = ji.job_id"
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    count_query = text(f"SELECT COUNT(*) {join_sql} {where_clause}")
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    page_query = text(
        "SELECT ja.job_id, ji.status, ji.created_at, ja.conversation_id, ja.project_collection "
        f"{join_sql} {where_clause} "
        "ORDER BY ji.created_at DESC, ja.job_id DESC "
        "LIMIT :limit OFFSET :offset"
    )
    return count_query, page_query


def find_research_runs(
    db_url: str,
    visible_to: JobCaller | None,
    project_collection: str | None,
    conversation_id: str | None,
    status: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    from sqlalchemy import inspect

    from ..jobs.event_store import EventStore

    EventStore._ensure_table_exists(db_url)
    engine = EventStore._get_or_create_sync_engine(db_url)

    if not inspect(engine).has_table("job_info"):
        return [], 0

    conditions: list[str] = []
    params: dict[str, Any] = {}

    if visible_to is not None:
        visibility, visibility_params = job_visibility_clause(visible_to)
        conditions.append(visibility)
        params.update(visibility_params)
    if project_collection is not None:
        conditions.append("ja.project_collection = :project_collection")
        params["project_collection"] = project_collection
    if conversation_id is not None:
        conditions.append("ja.conversation_id = :conversation_id")
        params["conversation_id"] = conversation_id
    if status is not None:
        conditions.append("ji.status = :status")
        params["status"] = status

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    count_query, page_query = _listing_queries(where_clause)
    with engine.connect() as conn:
        total = conn.execute(count_query, params).scalar() or 0
        rows = conn.execute(page_query, {**params, "limit": limit, "offset": offset}).mappings().all()

    return [dict(row) for row in rows], total
