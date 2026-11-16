from __future__ import annotations

import json

import pytest
from agent_testing.exposure import CHAT_AGENT
from agent_testing.exposure import CONFIG
from agent_testing.exposure import EXPOSURE
from agent_testing.exposure import chat_tool_names


@pytest.fixture(scope="module")
def exposure() -> dict[str, dict]:
    return json.loads(EXPOSURE.read_text(encoding="utf-8"))["operations"]


def test_every_native_tool_the_config_names_is_one_the_chat_agent_has(exposure: dict[str, dict]) -> None:
    tools = chat_tool_names()
    natives = {
        name: entry["agent"].removeprefix("native:")
        for name, entry in exposure.items()
        if isinstance(entry["agent"], str)
    }
    assert natives, "the config names no native tool: the fixture is not the one this test reads"
    unknown = {name: tool for name, tool in natives.items() if tool not in tools}
    assert unknown == {}, f"not in {CHAT_AGENT}'s tools of {CONFIG.name}: {unknown}"


def test_the_consultants_steps_hide_these_from_the_chat_agent_behind_its_own_tools(exposure: dict[str, dict]) -> None:
    expected = {
        "project-memory-create": "native:remember",
        "organization-memory-create": "native:remember",
        "bim-model-query": "native:ifc_query",
        "task-create": "native:create_task",
        "task-run-commission": "native:create_task",
        "annotation-create": "native:canvas__mark",
        "annotation-update": "native:canvas__update",
        "annotation-delete": "native:canvas__delete",
        "annotation-reply-create": "native:canvas__reply",
    }
    assert {name: exposure[name]["agent"] for name in expected} == expected
    assert all(exposure[name]["external"] for name in expected)


def test_the_tool_list_reader_sees_the_canvas_group() -> None:
    assert {"canvas__mark", "canvas__reply", "remember", "create_task"} <= chat_tool_names()


def test_the_door_looks_with_the_tool_agent_looks_with(exposure: dict[str, dict]) -> None:
    assert exposure["document-look"]["agent"] == "native:look"
    assert exposure["document-look"]["external"] is True
    assert "knowledge-image-view" not in exposure
    assert "look" in chat_tool_names()
