from agent.lazy_exports import lazy_exports

_LAZY = {
    "deep_research_agent": ".deep_researcher",
    "chat_deepresearcher_agent": ".piloti",
    "research_agent": ".piloti",
}

__all__ = [
    "chat_deepresearcher_agent",
    "research_agent",
    "deep_research_agent",
]


__getattr__ = lazy_exports(__name__, _LAZY)
