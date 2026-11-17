"""The two types a tool is described and fails with: ToolDef and ToolError."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolDef:
    """One operation by name. What it means to a model is written once, by the
    agent's ``ifc_measure`` (``agent/tools/bim``); the engine only runs it."""

    name: str
    handler: Callable[[dict[str, Any]], Any]


class ToolError(Exception):
    """A mistake the model can correct, phrased for the model.

    Distinct from every ``decidable: false`` answer: this means the call could
    not be made at all — no such model handle, no such GlobalId, no source. A
    "the file cannot say" is a successful result and must never arrive here.
    """
