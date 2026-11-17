import asyncio
import logging
import re
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware import ToolRetryMiddleware
from langchain.agents.middleware.types import ModelResponse
from langchain.agents.structured_output import ProviderStrategy
from langchain_core.messages import AIMessage
from langchain_core.messages import ToolMessage
from langgraph.errors import GraphBubbleUp

from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import get_session_registry
from agent.common import get_source_id_for_tool
from agent.common.budget_guard import RunBudgetExceededError
from agent.common.cost_tracking import BudgetExceededError
from agent.common.passage_fence import unfenced
from agent.common.turn_status import fail_subagent
from agent.common.turn_status import subagent_run

logger = logging.getLogger(__name__)


def is_retryable_tool_error(exc: Exception) -> bool:
    if isinstance(exc, (RunBudgetExceededError, BudgetExceededError)):
        return False
    return not isinstance(exc, ValueError)


class SelectiveToolRetryMiddleware(ToolRetryMiddleware):
    def __init__(self, *, no_retry_tools: Iterable[str] = (), **kwargs) -> None:
        super().__init__(**kwargs)
        self.no_retry_tools = set(no_retry_tools)

    @staticmethod
    def _request_tool_name(request) -> str:
        return request.tool.name if request.tool else request.tool_call["name"]

    def _handle_failure(self, tool_name: str, tool_call_id: str | None, exc: Exception, attempts_made: int):
        if isinstance(exc, (RunBudgetExceededError, BudgetExceededError)):
            raise exc
        return super()._handle_failure(tool_name, tool_call_id, exc, attempts_made)

    def wrap_tool_call(self, request, handler):
        tool_name = self._request_tool_name(request)
        try:
            if tool_name in self.no_retry_tools:
                return handler(request)
            return super().wrap_tool_call(request, handler)
        except GraphBubbleUp:
            raise
        except RunBudgetExceededError, BudgetExceededError:
            raise
        except Exception as exc:  # noqa: BLE001 - converted to an error ToolMessage for the model
            return self._handle_failure(tool_name, request.tool_call["id"], exc, 1)

    async def awrap_tool_call(self, request, handler):
        tool_name = self._request_tool_name(request)
        try:
            if tool_name in self.no_retry_tools:
                return await handler(request)
            return await super().awrap_tool_call(request, handler)
        except GraphBubbleUp:
            raise
        except RunBudgetExceededError, BudgetExceededError:
            raise
        except Exception as exc:  # noqa: BLE001 - converted to an error ToolMessage for the model
            return self._handle_failure(tool_name, request.tool_call["id"], exc, 1)


def _replace_tool_content(msg: ToolMessage, content: str) -> ToolMessage:
    return ToolMessage(content=content, tool_call_id=msg.tool_call_id, name=getattr(msg, "name", None), id=msg.id)


class EmptyContentFixMiddleware(AgentMiddleware):
    def __init__(self, placeholder: str = "empty content received."):
        self.placeholder = placeholder

    async def awrap_model_call(self, request, handler):
        fixed_messages = [
            _replace_tool_content(msg, self.placeholder) if isinstance(msg, ToolMessage) and not msg.content else msg
            for msg in request.messages
        ]
        return await handler(request.override(messages=fixed_messages))


_TOOL_NAME_ALIASES: dict[str, str] = {
    "open_file": "read_file",
    "find": "grep",
    "find_file": "glob",
}


class ToolNameSanitizationMiddleware(AgentMiddleware):
    def __init__(self, valid_tool_names: list[str]):
        self.valid_tool_names = set(valid_tool_names)

    def _sanitize_tool_name(self, name: str) -> str:
        if "<|channel|>" in name:
            candidate = name.split("<|channel|>", maxsplit=1)[0]
            if candidate in self.valid_tool_names:
                logger.info("Sanitized tool name: '%s' -> '%s'", name, candidate)
                return candidate

        if "." in name:
            candidate = name.split(".", maxsplit=1)[0]
            if candidate in self.valid_tool_names:
                logger.info("Sanitized tool name: '%s' -> '%s'", name, candidate)
                return candidate

        if name in _TOOL_NAME_ALIASES:
            mapped = _TOOL_NAME_ALIASES[name]
            if mapped in self.valid_tool_names:
                logger.info("Mapped tool name: '%s' -> '%s'", name, mapped)
                return mapped

        return name

    def _sanitize_message(self, msg: Any) -> Any:
        if not isinstance(msg, AIMessage) or not msg.tool_calls:
            return msg
        tool_calls = [{**tc, "name": self._sanitize_tool_name(tc["name"])} for tc in msg.tool_calls]
        if all(new["name"] == old["name"] for new, old in zip(tool_calls, msg.tool_calls, strict=True)):
            return msg
        return msg.model_copy(update={"tool_calls": tool_calls})

    async def awrap_model_call(self, request, handler):
        response = await handler(request)
        result = [self._sanitize_message(msg) for msg in response.result]
        if all(new is old for new, old in zip(result, response.result, strict=True)):
            return response
        return ModelResponse(result=result, structured_response=response.structured_response)


class DeferredStructuredOutputMiddleware(AgentMiddleware):
    def __init__(self, schema: Any) -> None:
        self.strategy = ProviderStrategy(schema, strict=True)

    async def awrap_model_call(self, request, handler):
        response = await handler(request)
        draft = response.result[-1] if response.result else None
        if not isinstance(draft, AIMessage) or draft.tool_calls:
            return response
        try:
            return await handler(
                request.override(
                    messages=[*request.messages, draft],
                    response_format=self.strategy,
                )
            )
        except Exception:
            logger.warning(
                "Structured-output formatting call failed; returning unformatted draft",
                exc_info=True,
            )
            return response


def _request_tool_name(tool: object) -> str | None:
    name = getattr(tool, "name", None)
    if isinstance(name, str):
        return name
    if not isinstance(tool, dict):
        return None
    if isinstance(tool.get("name"), str):
        return tool["name"]
    function = tool.get("function")
    if isinstance(function, dict) and isinstance(function.get("name"), str):
        return function["name"]
    return None


class ToolVisibilityMiddleware(AgentMiddleware):
    def __init__(self, hidden_tool_names: set[str]) -> None:
        self.hidden_tool_names = hidden_tool_names

    def _filter_tools(self, tools: list[object]) -> list[object]:
        if not self.hidden_tool_names:
            return tools
        return [tool for tool in tools if _request_tool_name(tool) not in self.hidden_tool_names]

    def wrap_model_call(self, request, handler):
        return handler(request.override(tools=self._filter_tools(request.tools)))

    async def awrap_model_call(self, request, handler):
        return await handler(request.override(tools=self._filter_tools(request.tools)))


class SubagentEventsMiddleware(AgentMiddleware):
    def __init__(self, subagent_names: Iterable[str], tool_name: str = "task") -> None:
        self.subagent_names = frozenset(subagent_names)
        self.tool_name = tool_name

    def wrap_tool_call(self, request, handler):
        return handler(request)

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call
        name = (call.get("args") or {}).get("subagent_type") if call.get("name") == self.tool_name else None
        if name not in self.subagent_names:
            return await handler(request)
        async with subagent_run(str(name), parent_tool_call_id=call.get("id")) as frame:
            result = await handler(request)
            if isinstance(result, ToolMessage) and result.status == "error":
                fail_subagent(frame, "tool_error")
            return result


class SourceRegistryMiddleware(AgentMiddleware):
    def __init__(
        self,
        source_tool_names: set[str] | None = None,
        *,
        excluded_file_names: Iterable[str] = (),
    ) -> None:
        self.registry = SourceRegistry()
        self._source_tool_names = source_tool_names or set()
        self._compact_source_keys: set[str] = set()
        self._excluded_keys = {self._locator_key(name) for name in excluded_file_names if name and name.strip()}
        self._read_keys: set[str] = set()
        self._lock = asyncio.Lock()

    def is_excluded(self, entry: SourceEntry) -> bool:
        if not self._excluded_keys:
            return False
        key = self._entry_key(entry)
        return key is not None and key in self._excluded_keys

    def read_file_names(self) -> set[str]:
        return set(self._read_keys)

    def is_excluded_locator(self, locator: str) -> bool:
        return bool(self._excluded_keys) and self._locator_key(locator) in self._excluded_keys

    def active_registry(self) -> SourceRegistry:
        return get_session_registry() or self.registry

    def has_sources(self) -> bool:
        return bool(self.active_registry().all_sources())

    @staticmethod
    def _locator_key(locator: str) -> str:
        locator = locator.strip()
        if locator.startswith(("http://", "https://")):
            return normalize_url(locator)
        filename, _ = parse_citation_key(locator)
        return filename.lower()

    @classmethod
    def _entry_key(cls, entry: SourceEntry) -> str | None:
        if entry.url:
            return cls._locator_key(entry.url)
        if entry.citation_key:
            return cls._locator_key(entry.citation_key)
        return None

    def register_research_note_sources(self, notes: list[object]) -> None:
        locators = (
            getattr(source, "locator", "") for note in notes for source in (getattr(note, "sources", None) or [])
        )
        self._compact_source_keys.update(
            key
            for key in (
                self._locator_key(locator) for locator in locators if isinstance(locator, str) and locator.strip()
            )
            if key not in self._excluded_keys
        )

    async def awrap_tool_call(self, request, handler):
        result = await handler(request)
        if not isinstance(result, ToolMessage) or not result.content:
            return result
        if getattr(result, "status", None) == "error":
            return result
        tool_call = getattr(request, "tool_call", None)
        tool_name = tool_call.get("name", "") if isinstance(tool_call, dict) else ""
        if tool_name not in self._source_tool_names:
            return result
        source_id = get_source_id_for_tool(tool_name)
        sources = extract_sources_from_tool_result(tool_name, str(result.content), source_id=source_id)
        sources = [s for s in sources if not self.is_excluded(s)]
        result = self._without_excluded_passages(result, tool_name)
        async with self._lock:
            active_registry = self.active_registry()
            for source in sources:
                active_registry.add(source)
            self._read_keys.update(
                key for key in (self._entry_key(s) for s in sources if not s.url and s.citation_key) if key
            )
        if sources:
            logger.info(
                "[CitationRegistry] Captured %d source(s) from %s: %s",
                len(sources),
                tool_name,
                [s.url or s.citation_key for s in sources],
            )
        return result

    def _without_excluded_passages(self, result: ToolMessage, tool_name: str) -> ToolMessage:
        if not self._excluded_keys or not isinstance(result.content, str):
            return result
        content, cut = _without_results(result.content, self.is_excluded_locator)
        if not cut:
            return result
        logger.info("[CitationRegistry] Cut %d passage(s) from %s: excluded by the reader", cut, tool_name)
        return result.model_copy(update={"content": content})

    def get_source_entries(self, mode: str = "compact") -> list[SourceEntry]:
        sources = self.active_registry().all_sources()
        if mode == "full" or not self._compact_source_keys:
            return sources
        compact_sources = [source for source in sources if self._entry_key(source) in self._compact_source_keys]
        return compact_sources or sources


_RESULT_HEADER_RE = re.compile(r"^--- Result \d+ ---$", re.MULTILINE)
_RESULT_END_RE = re.compile(r"^(?:--- Result \d+ ---$|## Trace-Lanes$|---\n\n## Query:)", re.MULTILINE)
_CITATION_LINE_RE = re.compile(r"^Citation: (.+)$", re.MULTILINE)


def _without_results(content: str, refused: Callable[[str], bool]) -> tuple[str, int]:
    kept: list[str] = []
    cursor = cut = 0
    for header in unfenced(_RESULT_HEADER_RE, content):
        end_match = next(unfenced(_RESULT_END_RE, content, header.end()), None)
        end = end_match.start() if end_match else len(content)
        citation = _CITATION_LINE_RE.search(content, header.end(), end)
        if citation is None or not refused(citation.group(1).strip()):
            continue
        kept.append(content[cursor : header.start()])
        cursor, cut = end, cut + 1
    kept.append(content[cursor:])
    return "".join(kept), cut


_TRUNCATION_SUFFIX = "\n\n[... truncated ...]"


def _is_image_block(block: Any) -> bool:
    return isinstance(block, dict) and block.get("type") in ("image_url", "image")


def _has_image(msg: ToolMessage) -> bool:
    return isinstance(msg.content, list) and any(_is_image_block(block) for block in msg.content)


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    parts = [
        block if isinstance(block, str) else str(block.get("text", ""))
        for block in content
        if not _is_image_block(block) and (isinstance(block, str) or isinstance(block, dict))
    ]
    return "\n".join(part for part in parts if part)


def _measured_chars(msg: ToolMessage) -> int:
    return len(_text_of(msg.content))


def _is_prunable(msg: Any, max_chars: int) -> bool:
    if not isinstance(msg, ToolMessage) or not msg.content:
        return False
    return _has_image(msg) or _measured_chars(msg) > max_chars


def _viewed_call_args(messages: Sequence[Any]) -> dict[str, dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    for msg in messages:
        for call in getattr(msg, "tool_calls", None) or []:
            if call.get("id"):
                calls[call["id"]] = call.get("args") or {}
    return calls


def _first_arg(args: Mapping[str, Any], *names: str) -> Any:
    return next((args[name] for name in names if args.get(name) not in (None, "")), None)


def _image_stub(msg: ToolMessage, args: Mapping[str, Any]) -> str:
    document = _first_arg(args, "file_name", "document", "name")
    page = _first_arg(args, "page_number", "page")
    region = _first_arg(args, "region")
    if document is None:
        caption = _text_of(msg.content).strip().splitlines()
        document = caption[0][:120] if caption else "unknown"
    label = str(document)
    if page is not None:
        label += f" p.{page}"
    if region is not None:
        label += f" {region}"
    return f"[image viewed: {label}]"


def _truncated(msg: ToolMessage, max_chars: int, calls: Mapping[str, Mapping[str, Any]] | None = None) -> str:
    if _has_image(msg):
        return _image_stub(msg, (calls or {}).get(msg.tool_call_id, {}))
    return _text_of(msg.content)[:max_chars] + _TRUNCATION_SUFFIX


def _evictions(
    messages: Sequence[Any],
    *,
    keep_last_n: int,
    max_chars: int,
    total_char_budget: int,
    already: Mapping[str, str],
) -> dict[str, str]:
    calls = _viewed_call_args(messages)
    oversized = [msg for msg in messages if _is_prunable(msg, max_chars)]
    window_start = max(len(oversized) - keep_last_n, 0)
    evicted = {msg.id: _truncated(msg, max_chars, calls) for msg in oversized[:window_start] if msg.id is not None}
    evicted = {msg_id: content for msg_id, content in evicted.items() if msg_id not in already}
    if total_char_budget <= 0:
        return evicted
    window = oversized[window_start:]
    total = sum(len(already.get(msg.id, _text_of(msg.content))) for msg in window)
    for msg in window:
        if total <= total_char_budget:
            break
        if msg.id is None or msg.id in already:
            continue
        evicted[msg.id] = _truncated(msg, max_chars, calls)
        total += len(evicted[msg.id]) - _measured_chars(msg)
    return evicted


class ToolResultPruningMiddleware(AgentMiddleware):
    _TRUNCATION_SUFFIX = _TRUNCATION_SUFFIX

    def __init__(self, keep_last_n: int = 3, max_chars: int = 500, total_char_budget: int = 0):
        self.keep_last_n = keep_last_n
        self.max_chars = max_chars
        self.total_char_budget = total_char_budget
        self._truncated_by_id: dict[str, str] = {}

    def _pruned(self, msg: Any) -> Any:
        truncated = self._truncated_by_id.get(msg.id) if isinstance(msg, ToolMessage) else None
        return msg if truncated is None else _replace_tool_content(msg, truncated)

    async def awrap_model_call(self, request, handler):
        self._truncated_by_id.update(
            _evictions(
                request.messages,
                keep_last_n=self.keep_last_n,
                max_chars=self.max_chars,
                total_char_budget=self.total_char_budget,
                already=self._truncated_by_id,
            )
        )
        if not self._truncated_by_id:
            return await handler(request)
        pruned = [self._pruned(msg) for msg in request.messages]
        if all(new is old for new, old in zip(pruned, request.messages, strict=True)):
            return await handler(request)
        return await handler(request.override(messages=pruned))
