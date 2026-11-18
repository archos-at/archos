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
