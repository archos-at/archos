from __future__ import annotations

from collections.abc import Iterable
from functools import cache
from typing import Any

from pydantic import BaseModel
from pydantic import TypeAdapter
from pydantic import model_validator

_MARKER = "__blank_is_omitted__"


@cache
def _holds_a_string(annotation: Any) -> bool:
    try:
        TypeAdapter(annotation).validate_python("")
    except Exception:  # noqa: BLE001 - any refusal means "not a string field"
        return False
    return True


def _blank(value: Any) -> bool:
    return isinstance(value, str) and not value.strip()


def blank_is_omitted(schema: type[BaseModel]) -> type[BaseModel]:
    if getattr(schema, _MARKER, False):
        return schema
    fields = frozenset(name for name, field in schema.model_fields.items() if not _holds_a_string(field.annotation))
    if not fields:
        return schema

    def _drop_blanks(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return {key: value for key, value in data.items() if not (key in fields and _blank(value))}

    lenient = type(
        schema.__name__,
        (schema,),
        {
            "__module__": schema.__module__,
            "__qualname__": schema.__qualname__,
            _MARKER: True,
            "_drop_blanks": model_validator(mode="before")(classmethod(_drop_blanks)),
        },
    )
    return lenient


def tolerate_blank_arguments(tool: Any) -> Any:
    schema = getattr(tool, "args_schema", None)
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        tool.args_schema = blank_is_omitted(schema)
    return tool


async def load_agent_tools(builder: Any, tool_refs: Iterable[Any], exclude: Iterable[str] | None = None) -> list[Any]:
    from nat.plugin_api import LLMFrameworkEnum

    tools = await builder.get_tools(tool_names=list(tool_refs), wrapper_type=LLMFrameworkEnum.LANGCHAIN)
    excluded = set(exclude or ())
    return [tolerate_blank_arguments(tool) for tool in tools if getattr(tool, "name", "") not in excluded]
