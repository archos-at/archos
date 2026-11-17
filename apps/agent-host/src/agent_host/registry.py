from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AgentConfig:
    class_path: str
    """Full module path to the agent class, e.g., 'agent.agents.deep_researcher.agent.DeepResearcherAgent'"""

    config_name: str
    """Agent-runtime config function name, e.g., 'deep_research_agent'"""

    description: str = ""
    """Human-readable description of the agent."""


AGENT_REGISTRY: dict[str, AgentConfig] = {}


def register_agent(
    agent_type: str,
    class_path: str,
    config_name: str,
    description: str = "",
) -> None:
    AGENT_REGISTRY[agent_type] = AgentConfig(
        class_path=class_path,
        config_name=config_name,
        description=description,
    )
    logger.debug("Registered agent: %s -> %s", agent_type, class_path)


def get_agent_config(agent_type: str) -> AgentConfig:
    if agent_type not in AGENT_REGISTRY:
        available = ", ".join(AGENT_REGISTRY.keys()) or "(none)"
        raise KeyError(f"Unknown agent type: '{agent_type}'. Available: {available}")
    return AGENT_REGISTRY[agent_type]


register_agent(
    agent_type="deep_researcher",
    class_path="agent.agents.deep_researcher.agent.DeepResearcherAgent",
    config_name="deep_research_agent",
    description="Performs comprehensive multi-loop deep research",
)

register_agent(
    agent_type="researcher",
    class_path="agent.agents.piloti.agent.ChatAgent",
    config_name="shallow_research_agent",
    description="Performs quick single-turn research",
)

register_agent(
    agent_type="project_intake",
    class_path="agent.agents.intake.agent.ProjectIntakeAgent",
    config_name="project_intake_agent",
    description="Reads a new project's documents and suggests its profile values (ADR-0111)",
)
