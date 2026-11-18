from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import tiktoken
import yaml
from agent_testing.tool_payloads import ROOT
from agent_testing.tool_payloads import built_tools

from agent.common.prompt_store import PromptStore
from agent.core import prompt as prompt_module
from agent.core import turn_tools

SYSTEM_CEILING = 8_300
TOOLS_CEILING = 20_493
TOOLS_WITHOUT_A_MODEL_CEILING = 11_393

_ENCODING = tiktoken.get_encoding("o200k_base")


def _tokens(text: str) -> int:
    return len(_ENCODING.encode(text, disallowed_special=()))


def _tool_tokens(name: str, description: str, schema: dict) -> int:
    payload = {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}
    return _tokens(json.dumps(payload, ensure_ascii=False))


@pytest.fixture(scope="module")
def chat_tools() -> dict[str, int]:
    built = built_tools()
    config = yaml.safe_load((ROOT / "configs" / "config_oib_openrouter.yml").read_text(encoding="utf-8"))
    names: list[str] = []
    for name in config["functions"]["shallow_research_agent"]["tools"]:
        names += [name] if name in built else sorted(key for key in built if key.startswith(f"{name}__"))
    return {name: _tool_tokens(name, *built[name]) for name in names}


def test_the_system_prompt_stays_under_its_ceiling(monkeypatch):
    monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))
    system = prompt_module.render_static_block(prompt_module.resolve_static_block().text)
    count = _tokens(system)
    print(f"system prompt: {count} tokens (o200k)")
    assert count <= SYSTEM_CEILING


def test_the_tools_stay_under_their_ceiling(chat_tools):
    total = sum(chat_tools.values())
    print(f"chat tools: {len(chat_tools)}, {total} tokens (o200k)")
    assert len(chat_tools) >= 20, "the configured tool list did not resolve"
    assert total <= TOOLS_CEILING


def test_a_project_without_a_model_is_not_sent_the_measuring_tools(chat_tools, monkeypatch):
    monkeypatch.setattr(turn_tools, "get_project_id_from_context", lambda: "p-1")
    turn_tools.set_project_models(frozenset())
    try:
        kept = [tool.name for tool in turn_tools.tools_in_scope([SimpleNamespace(name=n) for n in chat_tools])]
    finally:
        turn_tools.set_project_models(None)
    total = sum(chat_tools[name] for name in kept if name in chat_tools)
    print(f"chat tools in a project without a model: {len(kept)}, {total} tokens (o200k)")
    assert total <= TOOLS_WITHOUT_A_MODEL_CEILING
