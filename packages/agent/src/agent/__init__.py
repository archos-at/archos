from agent.lazy_exports import lazy_exports

__all__ = [
    "chat_deepresearcher_agent",
    "research_agent",
    "deep_research_agent",
]

__getattr__ = lazy_exports(__name__, dict.fromkeys(__all__, ".agents"))
