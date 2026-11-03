"""Tell the BFF an ingestion job settled, the moment it does.

The BFF used to learn a document was done only when someone next read a list
(``reconcile-status.ts``), polled by an open tab, and a document nobody looked
at stayed ``pending`` until the sweep came by. Now the moment a job ends for
good, this calls ``POST /api/internal/ingest/settled`` with
``{"job_ids": [...]}``. "For good" is the run's last word, not the adapter's
FAILED write: a job Hatchet tries again is not settled. So the call is made
where that is known: the ``settle`` step of the ``ingest-document`` workflow
and its failure handler (``ingest_execution.settle``, synchronous, so a
refused call fails the step and Hatchet tries it again), and
``ingest_status_store.settle_cancelled`` (a person's stop, in the background).
The BFF runs its existing reconcile for those jobs' documents, which emits
``document_ingest_finished`` and guards against settling one twice, so a push
that repeats one is harmless.

It never fails the job: the indexing is done before the push is made, and the
read path stays the fallback. With no service token
(``INTERNAL_API_TOKEN``, a dev stack) nothing is sent.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from agent.common import bff_http

logger = logging.getLogger(__name__)

PATH = "/api/internal/ingest/settled"
#: The BFF takes 1 to 200 ids per call.
MAX_IDS = 200
_TIMEOUT_SECONDS = 5.0

#: One thread is enough: a push is one short request, and a backlog of them
#: means the BFF is slow, which more threads would not make faster. It holds
#: job ids only while they are in flight.
_pusher = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest-settle-push")


def send_settled(job_ids: list[str]) -> int:
    """Send the settle call now, on this thread; how many documents the BFF settled.

    Raises ``bff_http.BffError`` when a call fails. Without a service token nothing is sent.
    """
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
    """``send_settled``, best effort: a failure is a WARN; how many documents the BFF settled."""
    try:
        return send_settled(job_ids)
    except bff_http.BffError as error:
        # Ids are no secret, but the message stays the class and the status.
        logger.warning(
            "Settle push for %d ingest job(s) failed: %s (%s)", len(job_ids), type(error).__name__, error.status
        )
        return 0


def notify_settled(job_ids: list[str]) -> None:
    """Push the settle call in the background. Never raises, never blocks the job."""
    if not job_ids or bff_http.internal_token() is None:
        return
    try:
        _pusher.submit(push_settled, list(job_ids))
    except RuntimeError:  # the process is shutting down; the sweep settles it
        logger.warning("Settle push for %d ingest job(s) dropped at shutdown", len(job_ids))
