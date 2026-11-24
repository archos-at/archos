from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.prebuilt import ToolNode

from agent.common import LLMProvider
from agent.common.cost_tracking import cost_tracker_var

from .models import ResearchAgentState

_DEFAULT_MAX_INPUT_TOKENS_PER_TURN = 600_000

_DEFAULT_MAX_CALLS_PER_ROUND = 12

CUTOFF_ROUNDS = "rounds"
CUTOFF_INPUT_TOKENS = "input_tokens"

_TURN_BINDING_KEY = "piloti_turn"


@dataclass(frozen=True)
class TurnConfig:
    llm_provider: LLMProvider | None = None
    tools: Sequence[BaseTool] | None = None
    disabled_sources: frozenset[str] = frozenset()
    prefetch: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class TurnBinding:
    llm: BaseChatModel
    llm_with_tools: Any
    tools: tuple[BaseTool, ...]
    tools_info: list[dict[str, str]]
    tool_node: ToolNode
    source_tool_names: frozenset[str]
    ceiling: int
    max_input_tokens: int = 0
    max_calls_per_round: int = 0
    prefetch: tuple[dict[str, Any], ...] = ()
    disabled_sources: frozenset[str] = frozenset()


def _recursion_limit(ceiling: int) -> int:
    return (ceiling * 2) + 10


def _turn_input_tokens() -> int:
    tracker = cost_tracker_var.get()
    if tracker is None:
        return 0
    return tracker.prompt_tokens


def _turn_cutoff(state: ResearchAgentState, binding: TurnBinding) -> str | None:
    if state.tool_iterations >= binding.ceiling:
        return CUTOFF_ROUNDS
    if binding.max_input_tokens > 0 and _turn_input_tokens() >= binding.max_input_tokens:
        return CUTOFF_INPUT_TOKENS
    return None
