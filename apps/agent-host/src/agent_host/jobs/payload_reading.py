from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


class PayloadReading:
    def _contains_tool_call_syntax(self, content: str) -> bool:
        if not content:
            return False
        return bool(self.TOOL_CALL_PATTERN.search(content))

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

    def _extract_input(self, inputs: dict | Any) -> Any:
        if not inputs:
            return None
        if isinstance(inputs, str):
            return inputs
        if isinstance(inputs, dict):
            if "input" in inputs:
                return inputs["input"]
            msg = _last_message(inputs)
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
            key = next((key for key in ("output", "result", "answer", "response") if key in outputs), None)
            if key is not None:
                return outputs[key]
            msg = _last_message(outputs)
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
        found = _LlmReading()

        try:
            if not hasattr(response, "generations") or not response.generations:
                return found.as_tuple()

            gen = response.generations[0][0] if response.generations[0] else None
            if not gen:
                return found.as_tuple()

            msg = getattr(gen, "message", None)
            if not msg and hasattr(gen, "generation_info"):
                msg = gen.generation_info.get("message") if gen.generation_info else None

            if msg:
                found.read(msg)
            elif hasattr(gen, "text"):
                found.content = gen.text

        except Exception as e:
            logger.debug("Error extracting LLM response: %s", e)

        return found.as_tuple()


def _last_message(payload: dict) -> Any:
    messages = payload.get("messages")
    return messages[-1] if messages else None


@dataclass
class _LlmReading:
    content: str | None = None
    thinking: str | None = None
    usage: dict | None = None
    has_tool_calls: bool = False

    def as_tuple(self) -> tuple[str | None, str | None, dict | None, bool]:
        return self.content, self.thinking, self.usage, self.has_tool_calls

    def read(self, msg: Any) -> None:
        if hasattr(msg, "content"):
            self.content = str(msg.content) if msg.content else None
        self._read_tool_calls(msg)
        self._read_thinking(msg)
        self._read_usage(msg)

    def _read_tool_calls(self, msg: Any) -> None:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            self.has_tool_calls = True
        elif hasattr(msg, "additional_kwargs") and msg.additional_kwargs.get("tool_calls"):
            self.has_tool_calls = True

    def _read_thinking(self, msg: Any) -> None:
        if hasattr(msg, "additional_kwargs") and msg.additional_kwargs:
            self.thinking = (
                msg.additional_kwargs.get("reasoning_content")
                or msg.additional_kwargs.get("thinking")
                or msg.additional_kwargs.get("reasoning")
            )
        if not self.thinking and hasattr(msg, "response_metadata") and msg.response_metadata:
            self.thinking = msg.response_metadata.get("reasoning_content") or msg.response_metadata.get("thinking")

    def _read_usage(self, msg: Any) -> None:
        if hasattr(msg, "usage_metadata") and msg.usage_metadata:
            self.usage = dict(msg.usage_metadata)
        elif hasattr(msg, "response_metadata") and msg.response_metadata:
            token_usage = msg.response_metadata.get("token_usage")
            if token_usage:
                self.usage = dict(token_usage)
