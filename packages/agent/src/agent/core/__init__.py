"""The research agent: the general answering agent for a chat turn.

Two agent-runtime registrations, because a chat turn is two things. ``register`` is the
answering agent itself; ``conversation_register`` is the workflow the agent runtime calls per
turn, which wires this agent and the deep researcher into the conversation
graph in :mod:`agent.core.conversation`.
"""

from agent.lazy_exports import lazy_exports

_LAZY = {
    "chat_deepresearcher_agent": ".conversation_register",
    "research_agent": ".register",
    "research_workflow": ".register",
}

__all__ = [
    "chat_deepresearcher_agent",
    "research_agent",
    "research_workflow",
]


__getattr__ = lazy_exports(__name__, _LAZY)
