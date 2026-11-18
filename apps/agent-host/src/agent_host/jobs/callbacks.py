from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from collections.abc import Callable
from datetime import UTC
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.citations.entries import SourceEntry
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import get_session_registry
from agent.citations.verification import cited_document_entries
from agent.citations.wire import source_entry_to_wire

if TYPE_CHECKING:
    from .event_store import EventStore

logger = logging.getLogger(__name__)


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


class AgentEventCallback(BaseCallbackHandler):
    OUTPUT_MIN_LENGTH = 200
    URL_PATTERN = re.compile(r'https?://[^\s<>"\')\]}>]+', re.IGNORECASE)
    SEARCH_TOOL_PATTERNS = {"search", "tavily", "web_search", "google", "bing"}
    TOOL_CALL_PATTERN = re.compile(r'\b[a-z][a-z0-9_]*\s*\(\s*(?:["\'{]|[a-z_]+\s*=)', re.IGNORECASE)

    AGENT_PATTERNS = {"agent"}
    AGENT_EXCLUDE_PATTERNS = {"middleware", "handler", "callback"}

    _job_discovered_urls: dict[str, set[str]] = {}
    _job_discovered_sources: dict[str, set[str]] = {}
    _job_cited_urls: dict[str, set[str]] = {}
    _cache_lock = threading.Lock()

    def __init__(
        self,
        event_store: EventStore | None = None,
        tool_artifact_mapping: ToolArtifactMapping | None = None,
        source_registry: SourceRegistry | Callable[[], SourceRegistry | None] | None = None,
    ):
        super().__init__()
        self._event_store = event_store
        self._tool_mapping = tool_artifact_mapping or ToolArtifactMapping()

        self._run_id_to_name: dict[str, str] = {}
        self._run_id_to_parent: dict[str, str] = {}
        self._agent_run_ids: dict[str, str] = {}  # {run_id: name}

        self._source_registry = source_registry
        self._source_excluded: Callable[[SourceEntry], bool] | None = None
        self._mirrored_registry = SourceRegistry()
        self._mirrored_registry_populated = False

        self._job_id = event_store.job_id if event_store else None
        self._instance_discovered_urls: set[str] = set()
        self._instance_discovered_sources: set[str] = set()
        self._instance_cited_urls: set[str] = set()
        self._init_job_url_sets()

    def _init_job_url_sets(self) -> None:
        if not self._job_id:
            return
        with AgentEventCallback._cache_lock:
            if self._job_id not in AgentEventCallback._job_discovered_urls:
                AgentEventCallback._job_discovered_urls[self._job_id] = set()
            if self._job_id not in AgentEventCallback._job_discovered_sources:
                AgentEventCallback._job_discovered_sources[self._job_id] = set()
            if self._job_id not in AgentEventCallback._job_cited_urls:
                AgentEventCallback._job_cited_urls[self._job_id] = set()

    @property
    def _discovered_urls(self) -> set[str]:
        if self._job_id and self._job_id in AgentEventCallback._job_discovered_urls:
            return AgentEventCallback._job_discovered_urls[self._job_id]
        return self._instance_discovered_urls

    @property
    def _discovered_sources(self) -> set[str]:
        if self._job_id and self._job_id in AgentEventCallback._job_discovered_sources:
            return AgentEventCallback._job_discovered_sources[self._job_id]
        return self._instance_discovered_sources

    @property
    def _cited_urls(self) -> set[str]:
        if self._job_id and self._job_id in AgentEventCallback._job_cited_urls:
            return AgentEventCallback._job_cited_urls[self._job_id]
        return self._instance_cited_urls

    @classmethod
    def cleanup_job_urls(cls, job_id: str) -> None:
        with cls._cache_lock:
            cls._job_discovered_urls.pop(job_id, None)
            cls._job_discovered_sources.pop(job_id, None)
            cls._job_cited_urls.pop(job_id, None)

    def _is_agent_like(self, name: str) -> bool:
        name_lower = name.lower()
        if any(exclude in name_lower for exclude in self.AGENT_EXCLUDE_PATTERNS):
            return False
        return any(pattern in name_lower for pattern in self.AGENT_PATTERNS)

    def _find_agent_for_run(self, run_id: str) -> tuple[str, str] | None:
        current = run_id
        visited = set()
        while current and current not in visited:
            visited.add(current)
            if current in self._agent_run_ids:
                return (self._agent_run_ids[current], current)
            current = self._run_id_to_parent.get(current)
        return None

    def _build_metadata_for_run(self, run_id: str, **extra: Any) -> dict[str, Any] | None:
        metadata: dict[str, Any] = {}

        agent_info = self._find_agent_for_run(run_id)
        if agent_info:
            metadata["workflow"] = agent_info[0]
            metadata["agent_id"] = agent_info[1]

        metadata.update({k: v for k, v in extra.items() if v is not None})
        return metadata if metadata else None

    def _emit(self, event: IntermediateStepEvent):
        if self._event_store:
            self._event_store.store(event.to_sse_dict())

    def _emit_artifact(
        self,
        artifact_type: ArtifactType,
        content: Any,
        name: str | None = None,
        **extra_data,
    ):
        workflow = extra_data.pop("workflow_source", None) or extra_data.get("workflow")
        agent_id = extra_data.pop("agent_id", None)
        data = {"type": artifact_type.value, "content": content, **extra_data}

        metadata: dict[str, Any] | None = None
        if workflow or agent_id:
            metadata = {}
            if workflow:
                metadata["workflow"] = workflow
            if agent_id:
                metadata["agent_id"] = agent_id

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.ARTIFACT,
                state=EventState.UPDATE,
                name=name,
                data=EventData(**data),
                metadata=metadata,
            )
        )

    def _get_chain_name(self, serialized: dict | None, **kwargs) -> str:
        if serialized:
            name = serialized.get("name") or serialized.get("id", [""])[-1]
            if name:
                return name
        return kwargs.get("name", "unknown")

    def set_source_registry(self, source_registry: SourceRegistry | Callable[[], SourceRegistry | None]) -> None:
        self._source_registry = source_registry

    def set_source_exclusion(self, excluded: Callable[[SourceEntry], bool]) -> None:
        self._source_excluded = excluded

    def _get_source_registry(self) -> SourceRegistry | None:
        provider = self._source_registry
        if provider is not None:
            registry: SourceRegistry | None
            try:
                registry = provider() if callable(provider) else provider
            except Exception:
                logger.warning("Attached source registry provider raised; falling back", exc_info=True)
                registry = None
            if registry is not None:
                return registry

        session_registry = get_session_registry()
        if session_registry is not None:
            return session_registry

        return self._mirrored_registry if self._mirrored_registry_populated else None

    def _mirror_sources(self, entries: list[SourceEntry]) -> None:
        if not entries:
            return
        try:
            with AgentEventCallback._cache_lock:
                for entry in entries:
                    self._mirrored_registry.add(entry)
                self._mirrored_registry_populated = True
        except Exception:
            logger.warning("Failed to mirror tool sources into the fallback registry", exc_info=True)

    def emit_final_report(self, content: str, cards: list[dict] | None = None) -> None:
        extra: dict[str, Any] = {"cards": cards} if cards else {}
        self._emit_artifact(
            ArtifactType.OUTPUT,
            content,
            output_category="final_report",
            **extra,
        )
        try:
            self._emit_cited_sources(content)
        except Exception:
            logger.warning("Failed to emit cited sources for the final report", exc_info=True)

    def _is_search_tool(self, tool_name: str) -> bool:
        tool_lower = tool_name.lower()
        return any(pattern in tool_lower for pattern in self.SEARCH_TOOL_PATTERNS)

    def _contains_tool_call_syntax(self, content: str) -> bool:
        if not content:
            return False
        return bool(self.TOOL_CALL_PATTERN.search(content))

    def _normalize_url(self, url: str) -> str:
        from urllib.parse import urlparse
        from urllib.parse import urlunparse

        try:
            parsed = urlparse(url)
            normalized_path = parsed.path.rstrip("/") if parsed.path != "/" else "/"
            normalized = urlunparse(
                (
                    parsed.scheme.lower(),
                    parsed.netloc.lower(),
                    normalized_path,
                    parsed.params,
                    parsed.query,
                    "",  # Remove fragment
                )
            )
            return normalized
        except Exception:
            return url

    def _extract_urls(self, text: str) -> list[str]:
        if not text:
            return []
        urls = self.URL_PATTERN.findall(str(text))
        cleaned = []
        for url in urls:
            url = url.rstrip(".,;:!?)'\"]}>)")
            if len(url) > 10 and "." in url:
                cleaned.append(url)
        return list(dict.fromkeys(cleaned))

    def _get_output_category(self, agent_info: tuple[str, str] | None = None) -> str:
        workflow_name = agent_info[0] if agent_info else None
        if not workflow_name:
            return "draft"
        workflow_lower = workflow_name.lower()
        if "researcher" in workflow_lower or "research" in workflow_lower:
            return "research_notes"
        if "orchestrator" in workflow_lower:
            return "draft"
        return "intermediate"

    def _emit_cited_sources(self, content: str) -> None:
        self._emit_cited_urls(content)
        self._emit_cited_documents(content)

    def _emit_cited_urls(self, content: str) -> None:
        urls = self._extract_urls(content)
        registry = self._get_source_registry()
        for url in urls:
            normalized = self._normalize_url(url)

            if registry is not None:
                is_valid = registry.has_url(url)
            else:
                is_valid = normalized in self._discovered_urls

            if is_valid:
                with AgentEventCallback._cache_lock:
                    if normalized in self._cited_urls:
                        continue
                    self._cited_urls.add(normalized)
                self._emit_artifact(
                    ArtifactType.CITATION_USE,
                    url,
                    name=url,
                    url=url,
                )

    def _emit_cited_documents(self, content: str) -> None:
        registry = self._get_source_registry()
        if registry is None:
            return
        try:
            entries = cited_document_entries(content, registry)
        except Exception:
            logger.warning("Failed to resolve cited documents", exc_info=True)
            return

        for entry in entries:
            wire = source_entry_to_wire(entry)
            identity = self._source_identity(wire)
            with AgentEventCallback._cache_lock:
                if identity in self._cited_urls:
                    continue
                self._cited_urls.add(identity)
            content_line = str(wire.get("content") or entry.citation_key or "")
            extra = {key: value for key, value in wire.items() if key != "content"}
            self._emit_artifact(
                ArtifactType.CITATION_USE,
                content_line,
                name=str(wire.get("title") or entry.citation_key or content_line),
                **extra,
            )

    def _emit_tool_artifact(self, tool_name: str, tool_input: Any, run_id: str = "") -> None:
        mapping = self._tool_mapping.get_mapping(tool_name)
        if not mapping:
            return

        artifact_type = mapping["artifact_type"]
        content_key = mapping["content_key"]
        name_key = mapping["name_key"]
        extra_keys = mapping["extra_keys"]

        content = None
        name = None
        extra_data = {}

        if isinstance(tool_input, dict):
            if content_key:
                content = tool_input.get(content_key)
            if name_key:
                name = tool_input.get(name_key)
            for key in extra_keys:
                if key in tool_input:
                    extra_data[key] = tool_input[key]
                    if not name and key in ("file_path", "path", "filename", "name"):
                        name = tool_input[key]
        elif isinstance(tool_input, list) and content_key == "todos":
            content = tool_input

        if content is not None:
            if artifact_type == ArtifactType.TODO and run_id:
                agent_info = self._find_agent_for_run(run_id)
                if agent_info:
                    extra_data["workflow"] = agent_info[0]
                    extra_data["agent_id"] = agent_info[1]
                    extra_data["source"] = "agent"
                else:
                    extra_data["source"] = "orchestrator"
            self._emit_artifact(artifact_type, content, name=name, **extra_data)

    def on_chain_start(self, serialized: dict | None, inputs: dict, **kwargs) -> None:
        name = self._get_chain_name(serialized, **kwargs)
        run_id = str(kwargs.get("run_id", ""))
        parent_run_id = str(kwargs.get("parent_run_id", "")) if kwargs.get("parent_run_id") else ""

        if run_id:
            self._run_id_to_name[run_id] = name
            if parent_run_id:
                self._run_id_to_parent[run_id] = parent_run_id

        if self._is_agent_like(name):
            self._agent_run_ids[run_id] = name

            self._emit(
                IntermediateStepEvent(
                    category=EventCategory.WORKFLOW,
                    state=EventState.START,
                    name=name,
                    data=EventData(input=self._extract_input(inputs)),
                    metadata=self._build_metadata_for_run(run_id),
                )
            )

    def on_chain_end(self, outputs: dict, **kwargs) -> None:
        run_id = str(kwargs.get("run_id", ""))
        name = self._run_id_to_name.pop(run_id, kwargs.get("name", ""))

        if self._is_agent_like(name):
            self._emit(
                IntermediateStepEvent(
                    category=EventCategory.WORKFLOW,
                    state=EventState.END,
                    name=name,
                    data=EventData(output=self._extract_output(outputs)),
                    metadata=self._build_metadata_for_run(run_id),
                )
            )

            if run_id in self._agent_run_ids:
                del self._agent_run_ids[run_id]

        self._run_id_to_parent.pop(run_id, None)

    def on_chain_error(self, error: BaseException, **kwargs) -> None:
        run_id = str(kwargs.get("run_id", ""))
        name = self._run_id_to_name.get(run_id, "unknown")

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.JOB,
                state=EventState.UPDATE,
                name="retry",
                data=EventData(output=f"Retrying {name}: {type(error).__name__}"),
                metadata=self._build_metadata_for_run(run_id),
            )
        )

    TOOL_INPUT_TRIM_LIMIT = 500

    def _trim_tool_input(self, parsed_input: Any) -> Any:
        if parsed_input is None:
            return None
        serialized = str(parsed_input)
        if len(serialized) <= self.TOOL_INPUT_TRIM_LIMIT:
            return parsed_input
        if isinstance(parsed_input, str):
            return parsed_input[: self.TOOL_INPUT_TRIM_LIMIT] + "..."
        return serialized[: self.TOOL_INPUT_TRIM_LIMIT] + "..."

    def on_tool_start(self, serialized: dict | None, input_str: str, **kwargs) -> None:
        tool_name = serialized.get("name", "unknown") if serialized else "unknown"
        run_id = str(kwargs.get("run_id", ""))
        parent_run_id = str(kwargs.get("parent_run_id", "")) if kwargs.get("parent_run_id") else ""

        if run_id:
            self._run_id_to_name[run_id] = tool_name
            if parent_run_id:
                self._run_id_to_parent[run_id] = parent_run_id

        parsed_input = self._parse_tool_input(input_str)

        emit_input = self._trim_tool_input(parsed_input)

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.TOOL,
                state=EventState.START,
                name=tool_name,
                data=EventData(input=emit_input) if emit_input else None,
                metadata=self._build_metadata_for_run(run_id),
            )
        )

        self._emit_tool_artifact(tool_name, parsed_input, run_id=run_id)

    def on_tool_end(self, output: str, **kwargs) -> None:
        run_id = str(kwargs.get("run_id", ""))
        tool_name = self._run_id_to_name.pop(run_id, kwargs.get("name", "unknown"))

        agent_info = self._find_agent_for_run(run_id)

        emit_output = self._trim_tool_input(str(output)) if output else None
        self._emit(
            IntermediateStepEvent(
                category=EventCategory.TOOL,
                state=EventState.END,
                name=tool_name,
                data=EventData(output=emit_output) if emit_output is not None else None,
                metadata=self._build_metadata_for_run(run_id),
            )
        )

        if output:
            self._emit_structured_citation_sources(
                tool_name,
                str(output),
                agent_id=agent_info[1] if agent_info else None,
                workflow=agent_info[0] if agent_info else None,
            )

        self._run_id_to_parent.pop(run_id, None)

    def _source_identity(self, wire: dict[str, Any]) -> str:
        citation_key = wire.get("citation_key")
        if isinstance(citation_key, str) and citation_key.strip():
            return f"key:{citation_key.strip().lower()}"
        url = wire.get("url")
        if isinstance(url, str) and url.strip():
            return f"url:{self._normalize_url(url)}"
        file_name = wire.get("file_name")
        if isinstance(file_name, str) and file_name.strip():
            page = wire.get("page")
            return f"file:{file_name.strip().lower()}:{page if page is not None else ''}"
        content = wire.get("content")
        if isinstance(content, str) and content.strip():
            return f"content:{content.strip().lower()[:200]}"
        return f"tool:{wire.get('tool') or 'unknown'}"

    def _emit_structured_citation_sources(
        self,
        tool_name: str,
        output: str,
        *,
        agent_id: str | None,
        workflow: str | None,
    ) -> None:
        try:
            entries = extract_sources_from_tool_result(tool_name, output)
        except Exception:
            logger.warning("Failed to extract sources from tool %s", tool_name, exc_info=True)
            entries = []

        useful = [
            entry for entry in entries if entry.url or entry.citation_key or (entry.source_type == "knowledge_layer")
        ]

        if not useful and self._is_search_tool(tool_name):
            for url in self._extract_urls(output):
                useful.append(SourceEntry(url=url, source_type="generic", tool_name=tool_name))
        if self._source_excluded is not None:
            useful = [entry for entry in useful if not self._source_excluded(entry)]

        self._mirror_sources(useful)

        for entry in useful:
            wire = source_entry_to_wire(entry)
            if not wire.get("tool"):
                wire["tool"] = tool_name
            identity = self._source_identity(wire)

            with AgentEventCallback._cache_lock:
                if identity in self._discovered_sources:
                    continue
                self._discovered_sources.add(identity)
                if entry.url:
                    self._discovered_urls.add(self._normalize_url(entry.url))

            content = str(wire.get("content") or entry.url or entry.citation_key or tool_name)
            name = str(wire.get("title") or wire.get("citation_key") or entry.url or content)
            extra = {key: value for key, value in wire.items() if key != "content"}
            self._emit_artifact(
                ArtifactType.CITATION_SOURCE,
                content,
                name=name,
                agent_id=agent_id,
                workflow=workflow,
                **extra,
            )

    def on_llm_start(self, serialized: dict, prompts: list, **kwargs) -> None:
        model_name = "unknown"
        if serialized:
            model_name = serialized.get("name") or serialized.get("id", ["unknown"])[-1]

        run_id = str(kwargs.get("run_id", ""))
        parent_run_id = str(kwargs.get("parent_run_id", "")) if kwargs.get("parent_run_id") else ""

        if run_id:
            self._run_id_to_name[run_id] = model_name
            if parent_run_id:
                self._run_id_to_parent[run_id] = parent_run_id

        metadata = self._build_metadata_for_run(run_id) or {}
        metadata["prompt_count"] = len(prompts) if prompts else 0

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.LLM,
                state=EventState.START,
                name=model_name,
                metadata=metadata if metadata else None,
            )
        )

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        if token:
            self._emit(
                IntermediateStepEvent(
                    category=EventCategory.LLM,
                    state=EventState.CHUNK,
                    data=EventData(chunk=token),
                )
            )

    THINKING_TRIM_LIMIT = 300
    THINKING_TRIM_SUFFIX = " [Trimmed - check traces for full logs]"

    def on_llm_end(self, response, **kwargs) -> None:
        run_id = str(kwargs.get("run_id", ""))
        model_name = self._run_id_to_name.pop(run_id, "unknown")

        content, thinking, usage, has_tool_calls = self._extract_llm_response(response)

        agent_info = self._find_agent_for_run(run_id)
        metadata = self._build_metadata_for_run(run_id) or {}
        if thinking:
            if len(thinking) > self.THINKING_TRIM_LIMIT:
                metadata["thinking"] = thinking[: self.THINKING_TRIM_LIMIT] + self.THINKING_TRIM_SUFFIX
            else:
                metadata["thinking"] = thinking
        if usage:
            metadata["usage"] = usage

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.LLM,
                state=EventState.END,
                name=model_name,
                data=None,
                metadata=metadata if any(v for v in metadata.values()) else None,
            )
        )

        if (
            content
            and len(content) >= self.OUTPUT_MIN_LENGTH
            and not has_tool_calls
            and not self._contains_tool_call_syntax(content)
        ):
            output_category = self._get_output_category(agent_info)
            self._emit_artifact(
                ArtifactType.OUTPUT,
                content,
                output_category=output_category,
                workflow_source=agent_info[0] if agent_info else None,
                agent_id=agent_info[1] if agent_info else None,
            )

        self._run_id_to_parent.pop(run_id, None)

    def on_chat_model_start(self, serialized: dict, messages: list, **kwargs) -> None:
        model_name = "unknown"
        if serialized:
            model_name = serialized.get("name") or serialized.get("kwargs", {}).get("model", "unknown")

        run_id = str(kwargs.get("run_id", ""))
        parent_run_id = str(kwargs.get("parent_run_id", "")) if kwargs.get("parent_run_id") else ""

        if run_id:
            self._run_id_to_name[run_id] = model_name
            if parent_run_id:
                self._run_id_to_parent[run_id] = parent_run_id

        metadata = self._build_metadata_for_run(run_id) or {}
        metadata["message_count"] = len(messages) if messages else 0

        self._emit(
            IntermediateStepEvent(
                category=EventCategory.LLM,
                state=EventState.START,
                name=model_name,
                metadata=metadata if metadata else None,
            )
        )

    def _extract_input(self, inputs: dict | Any) -> Any:
        if not inputs:
            return None
        if isinstance(inputs, str):
            return inputs
        if isinstance(inputs, dict):
            if "input" in inputs:
                return inputs["input"]
            if "messages" in inputs and inputs["messages"]:
                msg = inputs["messages"][-1]
                if hasattr(msg, "content"):
                    return msg.content
            return inputs
        return inputs

    def _extract_output(self, outputs: Any) -> Any:
        if outputs is None:
            return None
        if isinstance(outputs, str):
            return outputs
        if isinstance(outputs, dict):
            for key in ("output", "result", "answer", "response"):
                if key in outputs:
                    return outputs[key]
            if "messages" in outputs and outputs["messages"]:
                msg = outputs["messages"][-1]
                if hasattr(msg, "content"):
                    return msg.content
            return outputs
        return outputs

    def _parse_tool_input(self, input_str: str) -> dict | str:
        import ast

        if not input_str:
            return ""
        try:
            return ast.literal_eval(input_str)
        except Exception:
            return input_str

    def _extract_tool_output(self, output: Any) -> Any:
        if output is None:
            return None
        if isinstance(output, str):
            return output
        if hasattr(output, "update") and isinstance(output.update, dict):
            messages = output.update.get("messages", [])
            if messages and hasattr(messages[-1], "content"):
                return messages[-1].content
        if hasattr(output, "content"):
            return output.content
        return str(output)

    def _extract_llm_response(self, response) -> tuple[str | None, str | None, dict | None, bool]:
        content = None
        thinking = None
        usage = None
        has_tool_calls = False

        try:
            if not hasattr(response, "generations") or not response.generations:
                return content, thinking, usage, has_tool_calls

            gen = response.generations[0][0] if response.generations[0] else None
            if not gen:
                return content, thinking, usage, has_tool_calls

            msg = getattr(gen, "message", None)
            if not msg and hasattr(gen, "generation_info"):
                msg = gen.generation_info.get("message") if gen.generation_info else None

            if msg:
                if hasattr(msg, "content"):
                    content = str(msg.content) if msg.content else None

                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    has_tool_calls = True
                elif hasattr(msg, "additional_kwargs"):
                    tool_calls = msg.additional_kwargs.get("tool_calls")
                    if tool_calls:
                        has_tool_calls = True

                if hasattr(msg, "additional_kwargs") and msg.additional_kwargs:
                    thinking = (
                        msg.additional_kwargs.get("reasoning_content")
                        or msg.additional_kwargs.get("thinking")
                        or msg.additional_kwargs.get("reasoning")
                    )

                if not thinking and hasattr(msg, "response_metadata") and msg.response_metadata:
                    thinking = msg.response_metadata.get("reasoning_content") or msg.response_metadata.get("thinking")

                if hasattr(msg, "usage_metadata") and msg.usage_metadata:
                    usage = dict(msg.usage_metadata)
                elif hasattr(msg, "response_metadata") and msg.response_metadata:
                    token_usage = msg.response_metadata.get("token_usage")
                    if token_usage:
                        usage = dict(token_usage)

            elif hasattr(gen, "text"):
                content = gen.text

        except Exception as e:
            logger.debug("Error extracting LLM response: %s", e)

        return content, thinking, usage, has_tool_calls


DeepResearchEventCallback = AgentEventCallback
