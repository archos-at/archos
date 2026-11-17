from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from agent.common import bff_http

logger = logging.getLogger(__name__)

PATH = "/api/internal/ingest/settled"
MAX_IDS = 200
_TIMEOUT_SECONDS = 5.0

_pusher = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest-settle-push")


def send_settled(job_ids: list[str]) -> int:
    ids = [job_id for job_id in dict.fromkeys(job_ids) if job_id]
    if not ids or bff_http.internal_token() is None:
        return 0
    settled = 0
    for start in range(0, len(ids), MAX_IDS):
        answer = bff_http.post_json(PATH, {"job_ids": ids[start : start + MAX_IDS]}, timeout=_TIMEOUT_SECONDS)
        count = answer.get("settled") if isinstance(answer, dict) else None
        settled += count if isinstance(count, int) else 0
    return settled


def push_settled(job_ids: list[str]) -> int:
    try:
        return send_settled(job_ids)
    except bff_http.BffError as error:
        logger.warning(
            "Settle push for %d ingest job(s) failed: %s (%s)", len(job_ids), type(error).__name__, error.status
        )
        return 0


def notify_settled(job_ids: list[str]) -> None:
    if not job_ids or bff_http.internal_token() is None:
        return
    try:
        _pusher.submit(push_settled, list(job_ids))
    except RuntimeError:  # the process is shutting down; the sweep settles it
        logger.warning("Settle push for %d ingest job(s) dropped at shutdown", len(job_ids))
