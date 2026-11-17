"""The deep researcher: a multi-round research agent run as a subagent of a chat turn."""

from agent.lazy_exports import lazy_exports

_LAZY = {
    "deep_research_agent": ".register",
}

__all__ = [
    "deep_research_agent",
]


__getattr__ = lazy_exports(__name__, _LAZY)
