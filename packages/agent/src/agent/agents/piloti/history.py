import json
import logging
import re
from collections.abc import Callable
from functools import lru_cache
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langchain_core.messages import trim_messages

from agent.common.passage_fence import fenced_spans
from agent.common.passage_fence import unfenced

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_token_encoder():
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except (ImportError, OSError) as exc:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning("tiktoken unavailable (%s); history is budgeted by the 4-chars-per-token heuristic", exc)
        return None


def warm_token_encoder() -> bool:
    return _get_token_encoder() is not None


def _encoded_len(text: str) -> int:
    encoder = _get_token_encoder()
    if encoder is None:
        return max(1, len(text) // 4)
    return len(encoder.encode(text, disallowed_special=()))


def _count_message_tokens(messages) -> int:
    return sum(_encoded_len(_message_text(message)) + 4 for message in messages)


def _message_text(message: Any) -> str:
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    if content is None:
        return ""
    return content if isinstance(content, str) else json.dumps(content, default=str)


def trim_message_history(
    messages: list[BaseMessage],
    max_tokens: int,
    token_counter: Callable[..., int] | None = None,
) -> list[BaseMessage]:
    return trim_messages(
        messages=[m.model_dump() for m in messages],
        max_tokens=max_tokens,
        strategy="last",
        token_counter=token_counter or _count_message_tokens,
        start_on="human",
        include_system=True,
    )


# Remove this table, replay_retired_look_names and its test after 2026-12-01.
_RETIRED_LOOK_NAMES: dict[str, dict[str, str | None]] = {
    "view_knowledge_image": {"file_name": "document", "page_number": "page", "collection": None},
    "canvas__look": {},
}
_LOOK = "look"


def _look_args(name: str, args: Any) -> Any:
    if not isinstance(args, dict):
        return args
    renames = _RETIRED_LOOK_NAMES[name]
    mapped = {}
    for key, value in args.items():
        target = renames.get(key, key)
        if target is not None:
            mapped[target] = value
    return mapped


def replay_retired_look_names(messages: list[BaseMessage]) -> list[BaseMessage]:
    replayed: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, ToolMessage) and message.name in _RETIRED_LOOK_NAMES:
            message = message.model_copy(update={"name": _LOOK})
        elif isinstance(message, AIMessage) and _calls_retired_look(message):
            message = _with_look_calls(message)
        replayed.append(message)
    return replayed


def _calls_retired_look(message: AIMessage) -> bool:
    blocks = message.content if isinstance(message.content, list) else []
    return any(call.get("name") in _RETIRED_LOOK_NAMES for call in message.tool_calls) or any(
        isinstance(block, dict) and block.get("name") in _RETIRED_LOOK_NAMES for block in blocks
    )


def _with_look_calls(message: AIMessage) -> AIMessage:
    calls = [
        {**call, "name": _LOOK, "args": _look_args(call["name"], call.get("args"))}
        if call.get("name") in _RETIRED_LOOK_NAMES
        else call
        for call in message.tool_calls
    ]
    update: dict[str, Any] = {"tool_calls": calls}
    if isinstance(message.content, list):
        update["content"] = [
            {**block, "name": _LOOK, "input": _look_args(block["name"], block.get("input"))}
            if isinstance(block, dict) and block.get("name") in _RETIRED_LOOK_NAMES
            else block
            for block in message.content
        ]
    return message.model_copy(update=update)


# Anthropic, Context editing, 2026-11-09: clearing invalidates the cache, so prune once per batch.
PRUNE_BATCH_TURNS = 4

TRIM_TO_SHARE = 0.625


def prune_tool_results(messages: list[BaseMessage], *, keep_turns: int = 1, batch_turns: int = 1) -> list[BaseMessage]:
    messages = replay_retired_look_names(messages)
    boundaries = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
    if len(boundaries) <= keep_turns + 1:
        return list(messages)
    pruned_turns = (len(boundaries) - (keep_turns + 1)) // batch_turns * batch_turns
    if pruned_turns == 0:
        return list(messages)
    cutoff = boundaries[pruned_turns]
    pruned: list[BaseMessage] = []
    for index, message in enumerate(messages):
        if index >= cutoff or not isinstance(message, (AIMessage, ToolMessage)):
            pruned.append(message)
            continue
        if isinstance(message, ToolMessage):
            continue
        if getattr(message, "tool_calls", None):
            prose = _prose_only(message)
            if prose is None:
                continue
            message = prose
        pruned.append(message)
    return pruned


def history_window(messages: list[BaseMessage], max_tokens: int) -> list[BaseMessage]:
    pruned = prune_tool_results(messages, batch_turns=PRUNE_BATCH_TURNS)
    for fallback in ({}, {"keep_turns": 0}):
        if _count_message_tokens(pruned) <= max_tokens:
            break
        pruned = prune_tool_results(messages, **fallback)
    first = window_start(messages, max_tokens)
    humans = [i for i, m in enumerate(pruned) if isinstance(m, HumanMessage)]
    start = humans[first] if first < len(humans) else 0
    return trim_message_history(pruned[start:], max_tokens)


def window_start(messages: list[BaseMessage], max_tokens: int) -> int:
    prose = prune_tool_results(messages, keep_turns=0)
    starts = [i for i, m in enumerate(prose) if isinstance(m, HumanMessage)]
    if not starts:
        return 0
    sizes = [_count_message_tokens(prose[a:b]) for a, b in zip(starts, [*starts[1:], len(prose)], strict=True)]
    low = int(max_tokens * TRIM_TO_SHARE)
    first = 0
    for end in range(1, len(sizes) + 1):
        if sum(sizes[first:end]) <= max_tokens:
            continue
        while first < end - 1 and sum(sizes[first:end]) > low:
            first += 1
    return first


def _prose_only(message: AIMessage) -> AIMessage | None:
    content = message.content
    if isinstance(content, str):
        kept: str | list = content
        text = content
    else:
        kept = [block for block in content if isinstance(block, str) or block.get("type") == "text"]
        text = "".join(block if isinstance(block, str) else str(block.get("text") or "") for block in kept)
    if not text.strip():
        return None
    return message.model_copy(update={"content": kept, "tool_calls": [], "invalid_tool_calls": []})


_RESULT_BLOCK_RE = re.compile(r"^--- Result \d+ ---$", re.M)
_CITATION_LINE_RE = re.compile(r"^Citation: (.+)$", re.M)
UNCITED_PASSAGE_NOTE = "[passage not cited by the answer; open it again by its Path if it is needed]"


def compact_tool_results(messages: list[BaseMessage], cited_keys: set[str]) -> list[BaseMessage]:
    if not cited_keys:
        return list(messages)
    wanted = {key.strip() for key in cited_keys}
    return [
        message.model_copy(update={"content": _compact_block(message.content, wanted)})
        if isinstance(message, ToolMessage)
        and isinstance(message.content, str)
        and _RESULT_BLOCK_RE.search(message.content)
        else message
        for message in messages
    ]


def _compact_block(content: str, wanted: set[str]) -> str:
    starts = [m.start() for m in unfenced(_RESULT_BLOCK_RE, content)]
    if not starts:
        return content
    head = content[: starts[0]]
    pieces = [head]
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(content)
        block = content[start:end]
        match = _CITATION_LINE_RE.search(block)
        if match is not None and match.group(1).strip() in wanted:
            pieces.append(block)
            continue
        pieces.append(_header_only(block))
    return "".join(pieces)


def _header_only(block: str) -> str:
    header, sep, rest = block.partition("\n\n")
    if not sep:
        return block
    spans = fenced_spans(rest)
    after = rest[spans[0][1] :] if spans and spans[0][0] == 0 else None
    _body, tail_sep, tail = after.partition("\n\n") if after is not None else rest.partition("\n\n")
    return f"{header}\n\n{UNCITED_PASSAGE_NOTE}\n\n{tail}" if tail_sep else f"{header}\n\n{UNCITED_PASSAGE_NOTE}\n"
