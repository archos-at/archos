from __future__ import annotations

from . import client
from .session import IntakeSession

_WITHDRAW_TEXT = {
    "withdrawn": "withdrawn — no longer on the profile, and not refused: a later reading may record it again",
    "nothing-suggested": "refused: nothing is suggested under this key",
    "confirmed": "refused: a person confirmed this value; it stays",
    "not-this-reading": (
        "refused: not a suggestion of this reading (an earlier reading's, the derived building class, a default); "
        "it stays for a person to decide"
    ),
}


async def withdraw_values(session: IntakeSession, keys: list[str]) -> str:
    if session.stale:
        return "Not sent: this reading is no longer the project's current one. Call finish_intake and stop."
    if session.finished:
        return "Not sent: the intake is already finished."
    wanted = list(dict.fromkeys(key.strip() for key in keys or [] if key and key.strip()))
    if not wanted:
        return "Nothing to withdraw."
    batch = wanted[: client.MAX_RECORD_VALUES]
    reply = await client.call_intake("withdraw", client.withdraw_request(session.job_id, batch))
    session.stale = session.stale or reply.stale
    if not reply.ok:
        return reply.refusal
    lines = []
    for item in reply.body.get("results") or []:
        if not isinstance(item, dict):
            continue
        outcome, reason = str(item.get("outcome") or ""), str(item.get("reason") or "")
        if outcome == "withdrawn":
            session.outcomes["withdrawn"] += 1
        else:
            session.refusals[f"withdraw:{reason or 'unknown'}"] += 1
        lines.append(f"- {item.get('key')}: {_WITHDRAW_TEXT.get(reason or outcome, outcome or 'no outcome')}")
    if len(wanted) > len(batch):
        lines.append(f"[{len(wanted) - len(batch)} more key(s) not sent: at most {client.MAX_RECORD_VALUES} per call.]")
    return "\n".join(lines) or "No result returned."
