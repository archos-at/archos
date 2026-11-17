# drop after release 2026-W51
from agent.common.source_kinds import AGENT_AUTHORED_LANE

LEGACY_AGENT_AUTHORED_LANE = "office_piloti"


def is_agent_lane(value: str | None) -> bool:
    return value in (AGENT_AUTHORED_LANE, LEGACY_AGENT_AUTHORED_LANE)
