from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentConfig:
    load: Callable[[], type]
    """Imports the agent module on first use and returns the agent class."""

    config_name: str
    """Agent-runtime config function name, e.g., 'deep_research_agent'"""

    description: str = ""
    """Human-readable description of the agent."""


def _deep_researcher() -> type:
    from agent.agents.deep_researcher.agent import DeepResearcherAgent

    return DeepResearcherAgent


def _chat() -> type:
    from agent.core.agent import ChatAgent

    return ChatAgent


def _project_intake() -> type:
    from agent.agents.intake.agent import ProjectIntakeAgent

    return ProjectIntakeAgent


AGENT_REGISTRY: dict[str, AgentConfig] = {
    "deep_researcher": AgentConfig(
        load=_deep_researcher,
        config_name="deep_research_agent",
        description="Performs comprehensive multi-loop deep research",
    ),
    "researcher": AgentConfig(
        load=_chat,
        config_name="shallow_research_agent",
        description="Performs quick single-turn research",
    ),
    "project_intake": AgentConfig(
        load=_project_intake,
        config_name="project_intake_agent",
        description="Reads a new project's documents and suggests its profile values (ADR-0111)",
    ),
}


class UnknownAgentError(KeyError):
    def __str__(self) -> str:
        return str(self.args[0])


def get_agent_config(agent_type: str) -> AgentConfig:
    if agent_type not in AGENT_REGISTRY:
        available = ", ".join(AGENT_REGISTRY) or "(none)"
        raise UnknownAgentError(f"Unknown agent type: '{agent_type}'. Available: {available}")
    return AGENT_REGISTRY[agent_type]
