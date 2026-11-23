from __future__ import annotations

from typing import Annotated
from typing import Any

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


class IntakeAgentState(BaseModel):
    model_config = ConfigDict(extra="ignore", arbitrary_types_allowed=True)

    messages: Annotated[list[AnyMessage], add_messages] = Field(default_factory=list)
    organization_id: str | None = None
    project_context: str | None = None
    outcome: dict[str, Any] = Field(default_factory=dict)
