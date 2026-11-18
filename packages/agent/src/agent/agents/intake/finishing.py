from __future__ import annotations

from . import client
from .read_log import current_read_log
from .session import IntakeSession

MAX_HELD_ITEMS = 12


async def finish_intake(session: IntakeSession, summary: str) -> str:
    from agent.observability.turn_trace import current_trace_id_hex

    if session.finished:
        return "The intake is already finished."
    session.finished = True
    session.summary = (summary or "").strip()[: client.MAX_SUMMARY_CHARS]
    log = current_read_log()
    documents = log.documents_read if log is not None else []
    reply = await client.call_intake(
        "finish", client.finish_request(session.job_id, session.summary, documents, current_trace_id_hex())
    )
    if not reply.ok:
        session.stale = session.stale or reply.stale
        return f"Finished, but the intake API did not take it: {reply.refusal}"
    session.finish_status = str(reply.body.get("status") or "") or None
    return f"Intake finished ({session.finish_status or 'status unknown'}); {len(documents)} document(s) read."


def _named(items: list[str]) -> str:
    shown = ", ".join(items[:MAX_HELD_ITEMS])
    return shown + (f", … {len(items) - MAX_HELD_ITEMS} more" if len(items) > MAX_HELD_ITEMS else "")


async def finish_hold(session: IntakeSession) -> str | None:
    if session.finish_held or session.finished or session.stale:
        return None
    reply = await client.call_intake("needs", client.needs_request(session.job_id))
    if not reply.ok:
        return None
    session.remember_needs(reply.body)
    decisive = [key for key, need in session.needs.items() if need.get("decisive") and need.get("state") == "open"]
    log = current_read_log()
    read = set(log.documents_read if log is not None else [])
    unread = [str(name) for name in reply.body.get("unreadFiles") or [] if str(name) not in read]
    if not decisive or not unread:
        return None
    session.finish_held = True
    return (
        f"Not finished yet. Decisive needs still open, each could change what applies: {_named(decisive)}. "
        f"Files no reading has opened: {_named(unread)}. Read those that could state them, or call finish_intake "
        "again to finish as it is."
    )
