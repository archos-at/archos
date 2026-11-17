from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any
from typing import Literal

from agent.common import turn_status
from agent.common.source_kinds import canonical_shelf_value
from agent.common.status_keys import KEY_CITATIONS
from agent.common.status_keys import KEY_DOCUMENTS_PREFIX
from agent.common.status_keys import KEY_DOCUMENTS_WAITING
from agent.common.status_keys import KEY_ESCALATION
from agent.common.status_keys import KEY_REPAIR
from agent.common.status_keys import KEY_RETRIEVAL_PLAIN
from agent.common.status_keys import KEY_RETRIEVAL_REQUERY
from agent.common.status_keys import KEY_RETRIEVAL_WITH_QUERY
from agent.common.status_keys import KEY_SYNTHESIS
from agent.common.tool_calls import CHECKPOINT_FROM_NONE
from agent.common.tool_calls import LOCATOR_TOOL_BASENAMES
from agent.common.tool_calls import action_status_key
from agent.common.tool_calls import call_corpus
from agent.common.tool_calls import is_skill_read
from agent.common.tool_calls import locator_line
from agent.common.tool_calls import query_text
from agent.common.tool_calls import resolve_conclusion
from agent.common.tool_calls import tool_basename
from agent.common.turn_status import CHANNEL_TECHNICAL
from agent.common.turn_status import MAX_QUERY_CHARS
from agent.common.turn_status import MAX_REASON_CHARS
from agent.common.turn_status import STATUS_STEP_PREFIX
from agent.common.turn_status import clip
from agent.common.turn_status import current_retrieval_round
from agent.common.turn_status import status_step
from agent.common.wire_v2 import LookStep
from agent.common.wire_v2 import RetrievalStep
from agent.common.wire_v2 import StatusStep

logger = logging.getLogger(__name__)

_SHELF_IDS = {
    "office_shelf": "officeShelf",
    "project": "project",
    "session": "session",
}


_SHELF_SEVERAL = "several"


def documents_loading_step(shelves: list[str] | None = None) -> StatusStep | None:
    named: list[str] = []
    for shelf in shelves or ():
        shelf_id = _SHELF_IDS.get(canonical_shelf_value(str(shelf)))
        if shelf_id and shelf_id not in named:
            named.append(shelf_id)
    if not named:
        return None
    where = named[0] if len(named) == 1 else _SHELF_SEVERAL
    return status_step("documents", f"{KEY_DOCUMENTS_PREFIX}{where}", shelves=[str(shelf) for shelf in shelves or ()])


SUBJECT_DOCUMENT_SLOT = "documents:subject"


SUBJECT_UNREACHABLE = "unreachable"


SUBJECT_REFUSED = "refused"


SUBJECT_EMPTY = "empty"


SUBJECT_NOT_STORED = "not_stored"


SUBJECT_ABSENT = "absent"


def subject_document_step(
    *,
    loaded: bool,
    document_id: str | None = None,
    version_id: str | None = None,
    state: str | None = None,
    path: str | None = None,
    chars: int | None = None,
    reason: str | None = None,
) -> StatusStep:
    return status_step(
        SUBJECT_DOCUMENT_SLOT,
        channel=CHANNEL_TECHNICAL,
        loaded=loaded,
        document_id=document_id,
        version_id=version_id,
        state=state,
        path=path,
        chars=chars,
        reason=reason,
    )


def _describe_calls(calls: list[dict[str, Any]]) -> dict[str, Any]:
    corpora: list[str] = []
    tools: list[str] = []
    query: str | None = None
    locator: tuple[str, dict[str, str]] | None = None
    action_key: str | None = None
    for call in calls:
        base = tool_basename(str(call.get("name") or ""))
        if not base or is_skill_read(call):
            continue
        tools.append(base)
        corpus = call_corpus(base, call.get("args"))
        if corpus is not None:
            if corpus not in corpora:
                corpora.append(corpus)
            if base in LOCATOR_TOOL_BASENAMES:
                locator = locator or locator_line(call.get("args"))
            else:
                query = query or query_text(call.get("args"))
        elif action_key is None:
            action_key = action_status_key(base, call.get("args"), str(call.get("name") or ""))

    key: str | None
    values: dict[str, Any]
    if corpora:
        values = {"corpus": ",".join(corpora)}
        if query:
            values["query"] = clip(query, MAX_QUERY_CHARS)
            key = KEY_RETRIEVAL_WITH_QUERY
        elif locator is not None:
            key, values = locator
        else:
            key = KEY_RETRIEVAL_PLAIN
    elif action_key is not None:
        key = action_key
        values = {}
    else:
        key = None
        values = {}
    return {"corpora": corpora, "tools": tools, "query": query, "key": key, "values": values}


def record_round_announcement(
    *,
    round_index: int,
    calls: Sequence[dict[str, Any]],
    conclusion: str | None,
) -> dict[str, Any] | None:
    batch = [call for call in (calls or []) if isinstance(call, dict)]
    if not batch:
        return None
    described = _describe_calls(batch)
    if not described["corpora"]:
        return None
    reason_text, _conclusion_source = resolve_conclusion(batch, conclusion)
    announcement: dict[str, Any] = {
        "index": round_index,
        "key": described["key"],
        "tools": described["tools"],
        "corpora": described["corpora"],
    }
    if described["query"]:
        announcement["query"] = clip(described["query"], MAX_QUERY_CHARS)
    reason = clip(reason_text, MAX_REASON_CHARS) or None
    if reason is not None:
        announcement["reason"] = reason
    return announcement


def emit_retrieval(
    tool_calls: list[dict[str, Any]] | None,
    *,
    round_index: int,
    conclusion: str | None = None,
    prefetch: bool = False,
) -> bool:
    calls = [call for call in (tool_calls or []) if isinstance(call, dict)]
    if not calls:
        return False

    described = _describe_calls(calls)
    corpora = described["corpora"]
    tools = described["tools"]
    key = described["key"]
    values = described["values"]
    if key is None:
        return False

    reason_text, conclusion_source = resolve_conclusion(calls, conclusion)
    reason = clip(reason_text, MAX_REASON_CHARS) or None
    if corpora:
        turn_status.stamp_retrieval_round(round_index)
        turn_status.emit_step(
            RetrievalStep(
                id=f"{STATUS_STEP_PREFIX}retrieval:{round_index}",
                round=round_index,
                key=key,
                values=values,
                tools=tools,
                reason=reason,
                prefetch=prefetch,
            )
        )
        emit_checkpoint(round_index=round_index, has_conclusion=reason is not None, source=conclusion_source)
        return True
    slot = f"action:{key.rsplit('.', 1)[-1]}"
    turn_status.emit_status(slot, key, values=values, tools=tools, reason=reason)
    return False


LOOK_STEP_PREFIX = "look:"


def emit_look_step(
    number: int | str,
    *,
    document_name: str,
    page: int,
    document_id: str | None = None,
    revision_id: str | None = None,
    shelf: Literal["stored", "base"] = "stored",
    region: list[float] | None = None,
    image_index: int | None = None,
    where: str | None = None,
    question: str | None = None,
    reading: str | None = None,
) -> None:
    try:
        step = LookStep(
            id=f"{LOOK_STEP_PREFIX}{number}",
            round=current_retrieval_round(),
            document_name=clip(document_name, 300),
            document_id=document_id,
            revision_id=revision_id,
            shelf=shelf,
            page=page,
            region=region,
            image_index=image_index,
            where=clip(where, 60) if where else None,
            question=clip(question, 200) if question else None,
            reading=clip(reading, 300) if reading else None,
        )
    except ValueError:
        logger.warning("A look step did not validate (page=%s)", page, exc_info=True)
        return
    turn_status.emit_step(step)


CHECKPOINT_SLOT = "checkpoint"


def emit_checkpoint(*, round_index: int, has_conclusion: bool, source: str = CHECKPOINT_FROM_NONE) -> None:
    turn_status.emit_technical(
        f"{CHECKPOINT_SLOT}:{round_index}", round=round_index, hasConclusion=has_conclusion, source=source
    )


def documents_waiting_step(*, file_count: int) -> StatusStep:
    return status_step("documents:waiting", KEY_DOCUMENTS_WAITING, file_count=file_count)


def emit_retrieval_requery(*, query_count: int) -> None:
    turn_status.emit_status("retrieval:requery", KEY_RETRIEVAL_REQUERY, query_count=query_count)


def emit_citation_check(*, source_count: int | None = None) -> None:
    turn_status.emit_status("citations", KEY_CITATIONS, source_count=source_count)


def emit_answer_repair(*, quotes: int) -> None:
    turn_status.emit_status("repair", KEY_REPAIR, quotesFailed=quotes)


def emit_escalation(reason: str | None = None) -> None:
    reason_text = " ".join(str(reason).split()) if reason else ""
    turn_status.emit_status("escalation", KEY_ESCALATION, reason=clip(reason_text, MAX_REASON_CHARS) or None)


def emit_synthesis() -> None:
    turn_status.emit_status("synthesis", KEY_SYNTHESIS)
