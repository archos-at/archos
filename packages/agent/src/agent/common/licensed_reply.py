from __future__ import annotations

from typing import Any

from agent.common.licensed_text import QuoteCap

_JSON_KEYS = frozenset({"arguments", "args"})


class ChunkCap:
    def __init__(self, cap: QuoteCap) -> None:
        self._cap = cap
        self._runs: dict[str, Any] = {}

    def _feed(self, channel: str, text: str, *, json_raw: bool = False) -> str:
        run = self._runs.get(channel)
        if run is None:
            run = self._runs[channel] = self._cap.stream(json_raw=json_raw)
        return run.feed(text)

    def _walk(self, value: Any, channel: str, *, json_raw: bool = False) -> Any:
        if isinstance(value, str):
            return self._feed(channel, value, json_raw=json_raw)
        if isinstance(value, dict):
            index = value.get("index")
            return {
                key: self._walk(
                    item,
                    f"{channel}.{index if index is not None else ''}.{key}",
                    json_raw=json_raw or key in _JSON_KEYS,
                )
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [
                self._walk(item, f"{channel}[{position}]", json_raw=json_raw) for position, item in enumerate(value)
            ]
        return value

    def _content(self, content: Any) -> Any:
        if isinstance(content, str):
            return self._feed("content", content)
        if isinstance(content, list):
            return [
                {**part, "text": self._feed("content", part["text"])}
                if isinstance(part, dict) and isinstance(part.get("text"), str)
                else self._feed("content", part)
                if isinstance(part, str)
                else part
                for part in content
            ]
        return content

    def message(self, message: Any) -> Any:
        update: dict[str, Any] = {
            "content": self._content(message.content),
            "additional_kwargs": self._walk(dict(message.additional_kwargs or {}), "kwargs"),
        }
        chunks = getattr(message, "tool_call_chunks", None)
        if chunks:
            update["tool_call_chunks"] = [
                {**chunk, "args": self._feed(f"tool.{chunk.get('index')}", chunk["args"], json_raw=True)}
                if isinstance(chunk.get("args"), str)
                else chunk
                for chunk in chunks
            ]
            fields = message.model_dump(exclude={"tool_calls", "invalid_tool_calls", "tool_call_chunks"})
            return type(message)(**{**fields, **update})
        calls = getattr(message, "tool_calls", None)
        if calls:
            update["tool_calls"] = [
                {**call, "args": self._walk(call.get("args"), f"call.{position}")}
                for position, call in enumerate(calls)
            ]
        return message.model_copy(update=update)

    def chunk(self, chunk: Any) -> Any:
        from langchain_core.outputs import ChatGenerationChunk

        return ChatGenerationChunk(message=self.message(chunk.message), generation_info=chunk.generation_info)


def capped_result(result: Any, cap: QuoteCap | None) -> Any:
    if cap is None:
        return result
    from langchain_core.outputs import ChatGeneration
    from langchain_core.outputs import ChatResult

    generations = [
        ChatGeneration(message=ChunkCap(cap).message(generation.message), generation_info=generation.generation_info)
        for generation in result.generations
    ]
    return ChatResult(generations=generations, llm_output=result.llm_output)
