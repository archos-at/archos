from __future__ import annotations

import asyncio
from typing import Any

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.turn.response import turn_answer_message_id

from .client import CrossProjectLookupError
from .client import post_lookup

_NO_ENVELOPE = "Error: This run has no signed session credential, so other projects cannot be looked up. Do not retry."
_UNREACHABLE = (
    "Error: Looking up other projects is not reachable right now. Tell the user that "
    "it did not work; do not retry in the same answer."
)
_NOT_FOUND = (
    "This project does not exist, or not everyone who reads this chat may open it. Use a "
    "project_id from `<reference_projects>` or `find`."
)


class _Refused(Exception):
    def __init__(self, message: str, code: str = "invalid_arguments") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _envelope() -> SignedEnvelope:
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        raise _Refused(_NO_ENVELOPE, "no_envelope")
    return SignedEnvelope(header=header, signature=signature)


def _with_answer(payload: dict[str, Any]) -> dict[str, Any]:
    conversation_id = project_context.get_conversation_id_from_context()
    if not conversation_id:
        return payload
    return {**payload, "answerMessageId": turn_answer_message_id(conversation_id)}


async def _call(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    envelope = _envelope()
    try:
        return await asyncio.to_thread(post_lookup, path, _with_answer(payload), envelope)
    except CrossProjectLookupError as exc:
        if exc.code == "CROSS_PROJECT_AUDIENCE_CHANGED":
            raise _Refused(f"Not possible: {exc}", "audience_changed") from exc
        if exc.status == 404:
            raise _Refused(_NOT_FOUND, "not_found") from exc
        if exc.status in (400, 422):
            raise _Refused(f"Error: The request was invalid ({exc}). Correct the arguments.", "invalid") from exc
        raise _Refused(_UNREACHABLE, "unreachable") from exc
