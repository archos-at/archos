# drop after release 2026-W50
from __future__ import annotations

from ..registry import UnknownAgentError

LEGACY_AGENT_CLASS_PATHS = {
    "agent.agents.deep_researcher.agent.DeepResearcherAgent": "deep_researcher",
    "agent.core.agent.ChatAgent": "researcher",
    "agent.agents.piloti.agent.ChatAgent": "researcher",
    "agent.agents.intake.agent.ProjectIntakeAgent": "project_intake",
}

CLASS_PATH_OF = {
    "deep_researcher": "agent.agents.deep_researcher.agent.DeepResearcherAgent",
    "researcher": "agent.core.agent.ChatAgent",
    "project_intake": "agent.agents.intake.agent.ProjectIntakeAgent",
}


def agent_type_of(agent_class_path: str) -> str:
    try:
        return LEGACY_AGENT_CLASS_PATHS[agent_class_path]
    except KeyError:
        raise UnknownAgentError(f"Unknown agent class path in a queued job: '{agent_class_path}'") from None
