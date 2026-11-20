from __future__ import annotations

import time
import uuid
from datetime import UTC
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


class EventCategory(StrEnum):
    LLM = "llm"
    TOOL = "tool"
    WORKFLOW = "workflow"
    ARTIFACT = "artifact"
    JOB = "job"


class EventState(StrEnum):
    START = "start"
    CHUNK = "chunk"
    END = "end"
    UPDATE = "update"


class ArtifactType(StrEnum):
    FILE = "file"
    OUTPUT = "output"
    CITATION_SOURCE = "citation_source"
    CITATION_USE = "citation_use"
    TODO = "todo"


class EventData(BaseModel):
    model_config = ConfigDict(extra="allow")

    input: Any | None = None
    output: Any | None = None
    chunk: Any | None = None


class IntermediateStepEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: EventCategory
    state: EventState
    name: str | None = None
    timestamp: float = Field(default_factory=time.time)
    data: EventData | None = None
    metadata: dict[str, Any] | None = None

    @property
    def event_type(self) -> str:
        return f"{self.category.value}.{self.state.value}"

    def to_sse_dict(self) -> dict:
        result = {
            "type": self.event_type,
            "id": self.id,
            "name": self.name,
            "timestamp": datetime.fromtimestamp(self.timestamp, tz=UTC).isoformat(),
        }
        if self.data:
            result["data"] = self.data.model_dump(exclude_none=True)
        if self.metadata:
            result["metadata"] = self.metadata
        return {k: v for k, v in result.items() if v is not None}


class ToolArtifactMapping:
    def __init__(self):
        self._mappings: dict[str, dict] = {}
        self._register_defaults()

    def _register_defaults(self):
        self.register(
            "write_todos",
            artifact_type=ArtifactType.TODO,
            content_key="todos",
        )
        self.register(
            "write_file",
            artifact_type=ArtifactType.FILE,
            content_key="content",
            name_key="file_path",
            extra_keys=["file_path", "path", "filename"],
        )

    def register(
        self,
        tool_name: str,
        artifact_type: ArtifactType,
        content_key: str | None = None,
        name_key: str | None = None,
        extra_keys: list[str] | None = None,
    ):
        self._mappings[tool_name.lower()] = {
            "artifact_type": artifact_type,
            "content_key": content_key,
            "name_key": name_key,
            "extra_keys": extra_keys or [],
        }

    def get_mapping(self, tool_name: str) -> dict | None:
        return self._mappings.get(tool_name.lower())

    def is_artifact_tool(self, tool_name: str) -> bool:
        return tool_name.lower() in self._mappings
