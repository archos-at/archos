from agent.lazy_exports import lazy_exports
from agent.legacy_paths import install_legacy_paths

install_legacy_paths()

_LAZY = {
    "deep_research_agent": ".deep_researcher",
}

__all__ = [
    "deep_research_agent",
]


__getattr__ = lazy_exports(__name__, _LAZY)
