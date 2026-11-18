from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from .plugin import AgentHostConfig
    from .plugin import AgentHostWorker

__all__ = ["AgentHostConfig", "AgentHostWorker"]


def __getattr__(name: str) -> Any:
    if name in __all__:
        from . import plugin

        return getattr(plugin, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
