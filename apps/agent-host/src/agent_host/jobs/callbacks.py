from __future__ import annotations

import logging
import re
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry

if TYPE_CHECKING:
    from .event_store import EventStore

from .citation_events import CitationEvents
from .payload_reading import PayloadReading
from .step_events import ArtifactType
from .step_events import EventCategory
from .step_events import EventData
from .step_events import EventState
from .step_events import IntermediateStepEvent
from .step_events import ToolArtifactMapping

logger = logging.getLogger(__name__)


class AgentEventCallback(CitationEvents, PayloadReading, BaseCallbackHandler):
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

    def _emit_tool_artifact(self, tool_name: str, tool_input: Any, run_id: str = "") -> None:
        mapping = self._tool_mapping.get_mapping(tool_name)
        if not mapping:
            return

        artifact_type = mapping["artifact_type"]
        content, name, extra_data = _tool_artifact_fields(mapping, tool_input)

        if content is not None:
            if artifact_type == ArtifactType.TODO and run_id:
                self._mark_todo_source(extra_data, run_id)
            self._emit_artifact(artifact_type, content, name=name, **extra_data)

    def _mark_todo_source(self, extra_data: dict[str, Any], run_id: str) -> None:
        agent_info = self._find_agent_for_run(run_id)
        if agent_info:
            extra_data["workflow"] = agent_info[0]
            extra_data["agent_id"] = agent_info[1]
            extra_data["source"] = "agent"
        else:
            extra_data["source"] = "orchestrator"

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


def _tool_artifact_fields(mapping: dict, tool_input: Any) -> tuple[Any, Any, dict[str, Any]]:
    if isinstance(tool_input, dict):
        return _dict_artifact_fields(mapping, tool_input)
    if isinstance(tool_input, list) and mapping["content_key"] == "todos":
        return tool_input, None, {}
    return None, None, {}


def _dict_artifact_fields(mapping: dict, tool_input: dict) -> tuple[Any, Any, dict[str, Any]]:
    content = tool_input.get(mapping["content_key"]) if mapping["content_key"] else None
    name = tool_input.get(mapping["name_key"]) if mapping["name_key"] else None
    extra_data: dict[str, Any] = {}
    for key in mapping["extra_keys"]:
        if key not in tool_input:
            continue
        extra_data[key] = tool_input[key]
        if not name and key in ("file_path", "path", "filename", "name"):
            name = tool_input[key]
    return content, name, extra_data


DeepResearchEventCallback = AgentEventCallback
