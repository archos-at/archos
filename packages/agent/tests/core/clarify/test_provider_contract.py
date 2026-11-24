from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.common import LLMProvider
from agent.core.clarify import ClarifierSettings
from agent.core.clarify import build_deps
from agent.core.clarify import clarify
from agent.core.models import ClarificationResponse
from agent.core.models import ClarifyRequest
from tests.provider_doubles import ProviderContractError

ESCALATED_TURN_HISTORY = [
    HumanMessage(content="Brauche ich einen Aufzug bei meinem Projekt?"),
    AIMessage(content="Ja - bei deinem Projekt ist praktisch von einer Aufzugspflicht auszugehen."),
]


def _deps_for(llm):
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return build_deps(provider, [], None, ClarifierSettings(llm="clarifier_llm"), AsyncMock(return_value="skip"))


def _request() -> ClarifyRequest:
    return ClarifyRequest(messages=list(ESCALATED_TURN_HISTORY))


@pytest.mark.asyncio
async def test_the_step_survives_a_history_that_ends_on_an_assistant_turn(strict_provider_llm):
    complete = ClarificationResponse(needs_clarification=False, clarification_question=None)
    llm = strict_provider_llm([AIMessage(content=complete.model_dump_json())])

    result = await clarify(_request(), _deps_for(llm))

    assert result is not None
    assert llm.received, "the clarification step never called the model"
    for request in llm.received:
        assert request[-1].type != "ai"


@pytest.mark.asyncio
async def test_the_escalated_history_is_rejected_without_the_contract(strict_provider_llm):
    complete = ClarificationResponse(needs_clarification=False, clarification_question=None)
    llm = strict_provider_llm([AIMessage(content=complete.model_dump_json())], with_contract=False)

    with pytest.raises(ProviderContractError, match="ending with a model turn"):
        await clarify(_request(), _deps_for(llm))


@pytest.mark.asyncio
async def test_the_prior_assistant_answer_is_kept_as_context(strict_provider_llm):
    complete = ClarificationResponse(needs_clarification=False, clarification_question=None)
    llm = strict_provider_llm([AIMessage(content=complete.model_dump_json())])

    await clarify(_request(), _deps_for(llm))

    first_request = llm.received[0]
    assert any(m.type == "ai" and "Aufzugspflicht" in m.content for m in first_request)
