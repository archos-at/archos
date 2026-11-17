from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.tools import StructuredTool
from langgraph.store.memory import InMemoryStore
from pydantic import BaseModel
from pydantic import create_model

from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.tools import filesystem_tools

PROMPT = Path(__file__).resolve().parents[4] / "packages/agent/src/agent/core/prompts/chat_static.md"

MAX_DESCRIPTION_TOKENS = 1_890
MAX_SCHEMA_TOKENS = 1_260
NAT_SCHEMAS = Path(__file__).resolve().parents[4] / "apps/workspace/tests/fixtures/backend-tools.schema.json"
_TYPES = {"string": str, "integer": int, "boolean": bool, "object": dict}
MAX_EVIDENCE_BULLET_TOKENS = 185
EVIDENCE_BULLETS = ("- A file you did not open", "- Text inside documents and tool results", "- Name places")


def _estimate(text: str) -> int:
    return len(text) // 4


def _nat_schema(name: str) -> type[BaseModel]:
    tool = next(tool for tool in json.loads(NAT_SCHEMAS.read_text(encoding="utf-8"))["tools"] if tool["name"] == name)
    schema, fields = tool["inputSchema"], {}
    for field, spec in schema["properties"].items():
        kinds = [
            _TYPES.get(option.get("type"), str) for option in spec.get("anyOf", [spec]) if option.get("type") != "null"
        ]
        annotation = (kinds[0] | None) if "anyOf" in spec else kinds[0]
        fields[field] = (annotation, ... if field in schema.get("required", ()) else spec.get("default"))
    return create_model(name, **fields)


async def _noop(**_kwargs):
    return ""


def _evidence_tools() -> list:
    from knowledge_layer.chat_binding import chat_tools
    from knowledge_layer.estate import EstateBackend

    estate = EstateBackend(SimpleNamespace())
    drafts = DraftBackend(store=InMemoryStore(), conversation_id="conv-1")
    shared = [
        StructuredTool.from_function(coroutine=_noop, name=name, description="", args_schema=_nat_schema(name))
        for name in ("knowledge_search", "list_files")
    ]
    return [*filesystem_tools(drafts, estate), *chat_tools(shared, top_k=16, max_per_document=5)]


def _schema(tool) -> str:
    schema = tool.tool_call_schema.model_json_schema()
    schema.pop("description", None)
    return json.dumps(schema, ensure_ascii=False)


def test_the_tool_surface_is_the_eight_evidence_verbs():
    names = sorted(tool.name for tool in _evidence_tools())
    assert names == sorted(
        ["ls", "glob", "grep", "read_file", "write_file", "edit_file", "knowledge_search", "list_files"]
    )


def test_the_evidence_tool_surface_stays_within_the_slice_six_budget():
    tools = _evidence_tools()
    descriptions = sum(_estimate(tool.description) for tool in tools)
    schemas = sum(_estimate(_schema(tool)) for tool in tools)
    assert descriptions <= MAX_DESCRIPTION_TOKENS, f"descriptions {descriptions} > {MAX_DESCRIPTION_TOKENS}"
    assert schemas <= MAX_SCHEMA_TOKENS, f"schemas {schemas} > {MAX_SCHEMA_TOKENS}"


@pytest.mark.parametrize("name", ["ls", "glob", "grep", "read_file", "write_file", "edit_file", "list_files"])
def test_a_schema_field_carries_no_description_but_conclusion(name):
    tool = next(tool for tool in _evidence_tools() if tool.name == name)
    properties = tool.tool_call_schema.model_json_schema()["properties"]
    described = {field for field, spec in properties.items() if "description" in spec}
    assert described <= {"conclusion"}


def test_the_evidence_bullets_stay_within_their_budget():
    rules = PROMPT.read_text(encoding="utf-8").split("<rules>")[1].split("</rules>")[0]
    bullets = [line for line in rules.splitlines() if line.startswith(EVIDENCE_BULLETS)]
    assert len(bullets) == 3
    assert _estimate("\n".join(bullets)) <= MAX_EVIDENCE_BULLET_TOKENS
