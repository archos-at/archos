from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGeneration
from langchain_core.outputs import ChatGenerationChunk
from langchain_core.outputs import ChatResult
from pydantic import Field

from nat.llm.openai_llm import OpenAIModelConfig


def nat_langchain_client(model: Any) -> Any:
    return SimpleNamespace(default=model)


NAT_LLM_CONFIG = OpenAIModelConfig(model_name="test-model")


class ProviderContractError(RuntimeError): ...


class StrictProviderChatModel(BaseChatModel):
    responses: list[Any] = Field(default_factory=list)
    received: list[list[Any]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "strict-provider"

    def bind_tools(self, tools, **kwargs):
        return self.bind(tools=list(tools), **kwargs)

    def _validate(self, messages: list[Any]) -> None:
        if not messages:
            raise ProviderContractError("Request contains no messages")

        for earlier, following in zip(messages, messages[1:], strict=False):
            if getattr(earlier, "type", None) == "ai" and getattr(earlier, "tool_calls", None):
                if getattr(following, "type", None) != "tool":
                    raise ProviderContractError(
                        "An assistant turn with tool_calls must be followed by its tool results"
                    )

        last = messages[-1]
        if getattr(last, "type", None) == "ai":
            raise ProviderContractError("Requests ending with a model turn are not supported.")

    def _next_response(self) -> AIMessage:
        if not self.responses:
            return AIMessage(content="ok")
        reply = self.responses[0] if len(self.responses) == 1 else self.responses.pop(0)
        return AIMessage(content=reply) if isinstance(reply, str) else reply

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self._validate(list(messages))
        self.received.append(list(messages))
        return ChatResult(generations=[ChatGeneration(message=self._next_response())])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        self._validate(list(messages))
        self.received.append(list(messages))
        return ChatResult(generations=[ChatGeneration(message=self._next_response())])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        self._validate(list(messages))
        self.received.append(list(messages))
        yield ChatGenerationChunk(message=AIMessageChunk(content=self._next_response().content))
