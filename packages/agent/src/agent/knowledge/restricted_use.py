from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import urllib.parse
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common import bff_http
from agent.knowledge.restricted_collections import is_restricted_collection
from agent.knowledge.restricted_collections import restricted_collections_in

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0

WITHHELD_NOTICE = (
    "This result was withheld: it comes from a folder with restricted access "
    "that may not be used in this conversation. Answer without this content."
)


@dataclass
class RestrictedUse:
    organization_id: str
    user_id: str
    conversation_id: str
    project_id: str | None
    drawable: set[str] = field(default_factory=set)
    confined: bool = False
    admitted: set[str] = field(default_factory=set)
    answer_message_id: str | None = None

    def allows(self, collection: str) -> bool:
        return collection in self.drawable

    def drop(self, collections: Iterable[str]) -> None:
        self.drawable.difference_update(collections)

    def note_recorded(self) -> None:
        self.confined = True


_turn_use: contextvars.ContextVar[RestrictedUse | None] = contextvars.ContextVar("restricted_use", default=None)


def current_restricted_use() -> RestrictedUse | None:
    return _turn_use.get()


def bind_restricted_use(use: RestrictedUse | None) -> contextvars.Token:
    return _turn_use.set(use)


def reset_restricted_use(token: contextvars.Token) -> None:
    _turn_use.reset(token)


@dataclass
class CrossProjectTurn:
    drew_on_others: bool = False
    admitted: set[str] = field(default_factory=set)
    reference_order: list[str] = field(default_factory=list)


_cross_turn: contextvars.ContextVar[CrossProjectTurn | None] = contextvars.ContextVar(
    "cross_project_turn", default=None
)


def current_cross_project_turn() -> CrossProjectTurn | None:
    return _cross_turn.get()


def bind_cross_project_turn(turn: CrossProjectTurn | None) -> contextvars.Token:
    return _cross_turn.set(turn)


def reset_cross_project_turn(token: contextvars.Token) -> None:
    _cross_turn.reset(token)


def drew_on_other_projects() -> bool:
    turn = current_cross_project_turn()
    return turn is not None and turn.drew_on_others


def note_cross_project_hand_out(collections: Iterable[str | None], *, restricting: bool) -> None:
    turn = current_cross_project_turn()
    if turn is None:
        return
    if restricting:
        turn.drew_on_others = True
    turn.admitted.update(name for name in collections if isinstance(name, str) and name)


def without_restricted(entries: Sequence[Any]) -> list[Any]:
    return [entry for entry in entries if not is_restricted_collection(getattr(entry, "collection", None))]


def _post(use: RestrictedUse, body: dict[str, Any]) -> dict[str, Any] | None:
    payload = {"organizationId": use.organization_id, "userId": use.user_id, **body}
    if use.project_id:
        payload["projectId"] = use.project_id
    if use.answer_message_id:
        payload["answerMessageId"] = use.answer_message_id
    conversation = urllib.parse.quote(use.conversation_id, safe="")
    try:
        parsed = bff_http.post_json(
            f"/api/internal/conversations/{conversation}/restricted-use", payload, timeout=_TIMEOUT_SECONDS
        )
    except bff_http.BffNotConfiguredError:
        logger.warning("Restricted use for %s not checked: INTERNAL_API_TOKEN is not set", use.conversation_id)
        return None
    except bff_http.BffError:
        logger.warning("Restricted-use check for conversation %s failed", use.conversation_id, exc_info=True)
        return None
    return parsed if isinstance(parsed, dict) else None


def _names(value: object) -> list[str]:
    return [name for name in value if isinstance(name, str)] if isinstance(value, list) else []


def check_restricted_use(use: RestrictedUse, candidates: Sequence[str]) -> RestrictedUse:
    body = _post(use, {"candidates": list(dict.fromkeys(candidates))})
    if body is None:
        use.drawable = set()
        use.confined = True
        return use
    offered = set(candidates)
    use.drawable = {name for name in _names(body.get("drawable")) if name in offered}
    use.confined = bool(_names(body.get("recorded")))
    return use


def admit(use: RestrictedUse, collections: Sequence[str]) -> set[str]:
    asked = [name for name in dict.fromkeys(collections) if name]
    if not asked:
        return set()
    body = _post(use, {"admit": asked})
    admitted = set(_names(body.get("admitted"))) & set(asked) if body is not None else set()
    refused = set(asked) - admitted
    if refused:
        logger.warning(
            "Restricted content from %d collection(s) withheld in conversation %s", len(refused), use.conversation_id
        )
        use.drop(refused)
    if admitted:
        use.admitted.update(admitted)
        use.note_recorded()
    return admitted


async def begin_restricted_use(
    request: Any, conversation_id: str | None, *, answer_message_id: str | None = None
) -> RestrictedUse | None:
    candidates = restricted_collections_in(getattr(request, "collection_scope", None))
    if not candidates:
        return None
    organization_id = getattr(request, "organization_id", None)
    user_id = getattr(request, "user_id", None)
    use = RestrictedUse(
        organization_id=organization_id or "",
        user_id=user_id or "",
        conversation_id=conversation_id or "",
        project_id=getattr(request, "project_id", None),
        confined=True,
        answer_message_id=answer_message_id,
    )
    if not getattr(request, "envelope_header", None):
        logger.warning("Restricted collections in an unsigned scope: nothing drawable")
        return use
    if not organization_id or not user_id or not conversation_id:
        logger.warning("Restricted scope without an organization, asker or conversation: nothing drawable")
        return use
    return await asyncio.to_thread(check_restricted_use, use, candidates)


COLLECTIONS_READ_KEY = "grid_collections_read"

_call_reads: contextvars.ContextVar[set[str] | None] = contextvars.ContextVar("grid_collections_read", default=None)


def note_collections_read(collections: Iterable[str | None]) -> None:
    reads = _call_reads.get()
    if reads is None:
        return
    reads.update(name for name in collections if isinstance(name, str) and name)


async def report_collections_read(request: Any, execute: Any) -> Any:
    reads: set[str] = set()
    token = _call_reads.set(reads)
    try:
        result = await execute(request)
    finally:
        _call_reads.reset(token)
    return _stamped(result, reads)


def _stamped(result: Any, reads: set[str]) -> Any:
    if not reads:
        return result
    if isinstance(result, list):
        return [_stamped(item, reads) for item in result]
    metadata = getattr(result, "response_metadata", None)
    if not isinstance(metadata, dict):
        return result
    try:
        return result.model_copy(update={"response_metadata": {**metadata, COLLECTIONS_READ_KEY: sorted(reads)}})
    except Exception:  # noqa: BLE001 - the text backstop still sees a result we could not stamp
        logger.warning("Could not stamp the collections a tool call read", exc_info=True)
        return result


def collections_read(message: Any) -> set[str]:
    metadata = getattr(message, "response_metadata", None)
    value = metadata.get(COLLECTIONS_READ_KEY) if isinstance(metadata, dict) else None
    return set(_names(value))


_RESTRICTED_IN_TEXT = re.compile(r"(?<![\w-])proj_[\w-]+?_r[0-9a-f]{12}(?![\w-])", re.IGNORECASE)


def _text_of(message: Any) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, ensure_ascii=False, default=str)
    except TypeError, ValueError:
        return str(content)


def _carried(message: Any) -> set[str]:
    reported = {name for name in collections_read(message) if is_restricted_collection(name)}
    named = {match.group(0) for match in _RESTRICTED_IN_TEXT.finditer(_text_of(message))}
    return reported | {name for name in named if is_restricted_collection(name)}


async def admit_tool_results(messages: list[Any]) -> list[Any]:
    carried = [_carried(message) for message in messages]
    wanted = sorted(set().union(*carried)) if carried else []
    if not wanted:
        return messages
    use = current_restricted_use()
    cross = current_cross_project_turn()
    handed = {name for name in wanted if cross is not None and name in cross.admitted}
    admissible = [name for name in wanted if name not in handed and use is not None and use.allows(name)]
    admitted = await asyncio.to_thread(admit, use, admissible) if use is not None and admissible else set()
    admitted = admitted | handed
    if admitted.issuperset(wanted):
        return messages
    refused = set(wanted) - admitted
    logger.warning("Withheld tool results carrying %d restricted collection(s) not admitted", len(refused))
    return [
        _withheld(message) if names_in_message - admitted else message
        for message, names_in_message in zip(messages, carried, strict=True)
    ]


def may_name(collection: str | None) -> bool:
    if not is_restricted_collection(collection):
        return True
    use = current_restricted_use()
    cross = current_cross_project_turn()
    return (use is not None and collection in use.admitted) or (cross is not None and collection in cross.admitted)


def _withheld(message: Any) -> Any:
    try:
        return message.model_copy(update={"content": WITHHELD_NOTICE, "artifact": None})
    except Exception:  # noqa: BLE001 - a message type without model_copy keeps nothing of its content
        from langchain_core.messages import ToolMessage

        return ToolMessage(
            content=WITHHELD_NOTICE,
            tool_call_id=str(getattr(message, "tool_call_id", "") or ""),
            name=getattr(message, "name", None),
        )
