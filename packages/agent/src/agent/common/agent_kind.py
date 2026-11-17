"""The agent's actor kind: its new value, and the old one the database and the BFF still carry."""

from agent.common.legacy_agent_kind import LEGACY_AGENT_KIND

AGENT_KIND = "agent"
AGENT_KINDS = (AGENT_KIND, LEGACY_AGENT_KIND)


def is_agent_kind(value: object) -> bool:
    return value in AGENT_KINDS
