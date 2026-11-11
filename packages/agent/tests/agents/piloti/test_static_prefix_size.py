"""The static prefix of a chat call, in tokens, so it cannot creep back.

Every call of every turn starts with the bound tool schemas and the system
prompt, in that order. They are the bytes the cache breakpoint at the end of
the system block holds (``common/prompt_caching.py``), read at 0.05x when it
holds and written at 1.25x when it does not, so each token here is paid on
every call of the fleet. Counted with tiktoken ``o200k_base`` (the GPT
tokenizer; Claude's counts German higher, about x1.15), the way the token
report counted them (``docs/design/international/research/token-budget-2026-11.md``).

Measured 2026-11-10 after slice Q1: the system prompt 8,110 (10,685 before:
the ``calculation``/``formula`` shapes left it), the chat agent's 28 configured
tools 20,418, of which ``ifc_measure``, ``ifc_query`` and ``dxf_measure`` are
9,578 and are bound only where the project holds such a file (24 tools,
10,360, in a project without one, where a page that declared no viewer
also drops the client tool ``show_in_viewer``). Not counted: the six file
verbs a turn with a working directory adds (~1.7k), and the chat binding's
small rewrites of two descriptions.

Measured 2026-11-11 after the tool descriptions lost what they said twice
(``ifc_measure``, ``ifc_query``, ``remember``): the tools 19,844 (20,897
before), the three model tools 8,628 of them, and 10,736 in a project without
a model; the system prompt 8,052.

Measured 2026-11-11 with ``drawing_measure`` (ADR-0182): 1,357 tokens, its description 529 of them. The
tools 21,242 with it; 10,777 in a project without a model or a PDF, where it is not bound; 12,134 in a
project that holds a PDF and no model, in an organization with the ``drawing-measure`` entitlement. With
the kind "a PDF" that is nearly every project of such an organization, so that case has its own ceiling.

The ceilings are a ratchet: a change that grows the prefix past one fails here
and has to say why in the same change; one that shrinks it lowers them. A
tool ceiling sits roughly 450 to 500 tokens above its measurement,
the margin the first measurement set: 20,418 under 20,900.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import tiktoken
import yaml
from agent_testing.tool_payloads import ROOT
from agent_testing.tool_payloads import built_tools

from agent.agents.piloti import prompt as prompt_module
from agent.agents.piloti import turn_tools
from agent.common.prompt_store import PromptStore

SYSTEM_CEILING = 8_300
TOOLS_CEILING = 21_700
#: Inside a project that holds neither an IFC nor a DXF, nor a PDF the organization may have measured.
TOOLS_WITHOUT_A_MODEL_CEILING = 11_200
#: Inside a project that holds a PDF and no model, in an organization with the `drawing-measure` entitlement.
TOOLS_WITH_A_PDF_CEILING = 12_600

_ENCODING = tiktoken.get_encoding("o200k_base")


def _tokens(text: str) -> int:
    return len(_ENCODING.encode(text, disallowed_special=()))


def _tool_tokens(name: str, description: str, schema: dict) -> int:
    """One tool as Chat Completions carries it."""
    payload = {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}
    return _tokens(json.dumps(payload, ensure_ascii=False))


@pytest.fixture(scope="module")
def chat_tools() -> dict[str, int]:
    """The chat agent's configured tools, function groups expanded, each with its token count."""
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


def test_a_project_with_a_pdf_adds_only_the_drawing_tool(chat_tools, monkeypatch):
    monkeypatch.setattr(turn_tools, "get_project_id_from_context", lambda: "p-1")
    turn_tools.set_project_models(frozenset({"pdf"}))
    try:
        kept = [tool.name for tool in turn_tools.tools_in_scope([SimpleNamespace(name=n) for n in chat_tools])]
    finally:
        turn_tools.set_project_models(None)
    total = sum(chat_tools[name] for name in kept if name in chat_tools)
    print(f"chat tools in a project with a PDF and no model: {len(kept)}, {total} tokens (o200k)")
    assert "drawing_measure" in kept and "dxf_measure" not in kept
    assert total <= TOOLS_WITH_A_PDF_CEILING
