from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any



@dataclass(frozen=True)
class ToolDef:

    name: str
    handler: Callable[[dict[str, Any]], Any]


class ToolError(Exception):
    ...
