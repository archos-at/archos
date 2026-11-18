from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from nat.builder.workflow_builder import WorkflowBuilder

_active_builder: WorkflowBuilder | None = None


def set_active_builder(builder: WorkflowBuilder | None) -> None:
    global _active_builder
    _active_builder = builder


def get_active_builder() -> WorkflowBuilder | None:
    return _active_builder
