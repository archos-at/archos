"""One tool-free model call that answers in a given JSON shape.

Shared by the memory-reflection pass (``memory/reflection.py``), the memory
restriction judge (``memory/restriction.py``) and the claim judge
(``common/claim_judge.py``). It lived in ``memory/reflection.py`` until that
file outgrew the size limit; ``agent.memory.reflection.structured_reply`` still
resolves, for the callers that import it from there.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel

from agent.common.llm_factory import strict_json_response_format
from agent.common.message_utils import content_to_text
from agent.common.prompt_caching import one_shot_calls

logger = logging.getLogger(__name__)

#: The statuses a provider answers with when it rejects the request's SHAPE (an
#: unsupported ``response_format``) — never auth, quota, a server fault or a
#: transport error, all of which fail the same way without the parameter and
#: whose retry only doubles the cost of the slowest case.
#:
#: Duplicated from the chat agent's ``envelope_call.is_parameter_rejection``
#: rather than imported: that module sits inside the research package,
#: whose ``__init__`` pulls the whole agent in, and this one is imported from a
#: post-answer stage.
_PARAMETER_REJECTION_STATUSES = frozenset({400, 422})


def _rejects_response_format(exc: BaseException) -> bool:
    """Whether ``exc`` is the provider refusing the request's parameters.

    Duck-typed on the status code so it holds for ``openai.APIStatusError``
    (``status_code``), ``httpx.HTTPStatusError`` and ``requests.HTTPError``
    (``response.status_code``) alike.
    """
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return status in _PARAMETER_REJECTION_STATUSES


async def structured_reply(llm: Any, messages: list[Any], schema: type[BaseModel]) -> str:
    """Ask ``llm`` for a reply shaped like ``schema`` and return it as text.

    Requests native strict json_schema structured output; the response-healing
    plugin (forced on OpenRouter LLMs in llm_factory) repairs any fenced/prose
    JSON provider-side. The call is tool-free, so binding ``response_format``
    cannot silently cost it a tool call the way it can on a tool-bound one
    (the chat agent's ``envelope_call.py``). A provider that rejects the
    parameter gets one plain retry; anything else propagates. Shared with the
    memory restriction judge (``memory/restriction.py``), which asks the same
    model the same way.
    """
    # Each caller's evidence is its own: an entry written here would never be read.
    try:
        with one_shot_calls():
            response = await _ask_for_json(llm, messages, schema)
    except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting a parameter
        if not _rejects_response_format(exc):
            raise
        # Asked again without the cache switch, which a provider may not know.
        logger.warning(
            "%s call rejected even without response_format (%s); retrying with caching as usual", schema.__name__, exc
        )
        response = await _ask_for_json(llm, messages, schema)
    return content_to_text(getattr(response, "content", response))


async def _ask_for_json(llm: Any, messages: list[Any], schema: type) -> Any:
    """One call under the strict JSON format, and one plain retry when the provider rejects the parameter."""
    try:
        return await llm.bind(response_format=strict_json_response_format(schema)).ainvoke(messages)
    except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting the parameter
        if not _rejects_response_format(exc):
            raise
        logger.warning("%s response_format rejected by the provider (%s); retrying without it", schema.__name__, exc)
        return await llm.ainvoke(messages)
