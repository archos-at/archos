from __future__ import annotations

import base64
import logging
import os
from typing import Any

from starlette.datastructures import Headers

from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import PROJECT_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import USER_ID_HEADER

logger = logging.getLogger(__name__)

JOB_DEGRADED_EVENT_TYPE = "job.degraded"

_DEGRADED_EVENT_FIELDS = ("research_truncated", "truncation_reason", "degraded_reasons")

WORKER_IDENTITY_HEADERS: tuple[str, ...] = (PROJECT_ID_HEADER, ORGANIZATION_ID_HEADER, USER_ID_HEADER)

WORKER_ENVELOPE_HEADERS: tuple[str, ...] = (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER)


def _identity_values(identity: dict) -> tuple[object, object, object]:
    return (identity.get("project_id"), identity.get("organization_id"), identity.get("user_id"))


def _normalize_trace_id(trace_id: int | str | None) -> int | None:
    if trace_id is None:
        return None
    if isinstance(trace_id, int):
        return trace_id
    try:
        return int(trace_id, 16)
    except ValueError:
        return int(trace_id)


def _delete_thread(conn: Any, text: Any, job_id: str) -> None:
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(f"DELETE FROM {table} WHERE thread_id = :tid"),  # noqa: S608
            {"tid": job_id},
        )


def _purge_deep_checkpoint(job_id: str) -> None:
    dsn = os.environ.get("DEEP_CHECKPOINT_DB")
    if not dsn:
        return
    try:
        from sqlalchemy import text

        from .event_store import EventStore

        engine = EventStore._get_or_create_sync_engine(dsn)
        with engine.connect() as conn:
            _delete_thread(conn, text, job_id)
            conn.commit()
    except Exception:
        logger.debug("Deep checkpoint purge skipped for job %s", job_id, exc_info=True)


def _b64url_encode_text(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).rstrip(b"=").decode()


def _inject_worker_headers(context_state: Any, headers: dict[str, str]) -> None:
    request_attrs = context_state.metadata.get()
    existing = dict(request_attrs.headers) if request_attrs and request_attrs.headers else {}
    request_attrs._request.headers = Headers(headers={**existing, **headers})
    context_state.metadata.set(request_attrs)


def _run_user_info(user_info: dict | None, envelope_headers: dict[str, str] | None) -> dict | None:
    if user_info is not None or not envelope_headers:
        return user_info
    from agent.project_context import RequestContext
    from agent.turn.context import user_info_for

    request = RequestContext.from_headers(envelope_headers, secret=os.environ.get("INTERNAL_API_TOKEN"))
    return user_info_for(request)
