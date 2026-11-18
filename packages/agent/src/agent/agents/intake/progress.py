from __future__ import annotations

from . import client
from .read_log import current_read_log
from .session import IntakeSession


async def report_progress(session: IntakeSession) -> None:
    if session.stale or session.finished or not session.job_id:
        return
    log = current_read_log()
    opened = log.documents_read if log is not None else []
    if len(opened) <= session.files_reported:
        return
    reply = await client.call_intake("progress", client.progress_request(session.job_id, opened))
    if not reply.ok:
        session.stale = session.stale or reply.stale
        return
    session.files_reported = len(opened)
    session.progress_reports += 1
