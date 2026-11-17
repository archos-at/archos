from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import openai
import pytest
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common import AgentGroup
from agent.common import LLMProvider
from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent.common.llm_factory import apply_openrouter_structured_defaults
from agent.common.llm_factory import enforce_chat_request_contract
from agent.core.agent import ChatAgent
from agent.core.answer_pipeline import this_turn
from agent.core.models import ResearchAgentState
from tests.fixtures.drafting_turns import DRAFTING_CASES
from tests.fixtures.drafting_turns import FILE
from tests.fixtures.drafting_turns import assert_turn_shape
from tests.fixtures.drafting_turns import traced_tool_name

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_OIB_CONFIG = _REPO_ROOT / "configs" / "config_oib_openrouter.yml"
_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.environ.get("OPENROUTER_API_KEY"),
        reason="live model eval: needs OPENROUTER_API_KEY (see docs/contributing/testing-and-verification.md)",
    ),
]

_DATA_SOURCES = [
    {
        "id": "web_search",
        "name": "Web Search",
        "description": "Search the web for real-time information.",
        "tools": ["web_search_tool"],
    },
    {
        "id": "knowledge_layer",
        "name": "Knowledge Base",
        "description": "Search uploaded documents and files.",
        "tools": ["knowledge_search"],
    },
    {
        "id": "ris",
        "name": "RIS – Österreichisches Recht",
        "description": "Search Austrian federal/state law in the official RIS and fetch entire documents.",
        "tools": ["ris_search_tool", "ris_fetch_tool"],
    },
]
_DATA_SOURCE_TOOL_NAMES = frozenset(name for source in _DATA_SOURCES for name in source["tools"])

_KNOWLEDGE_HIT = """\
--- Result 1 ---
Source: OIB-Richtlinie 4 – Nutzungssicherheit und Barrierefreiheit (Ausgabe April 2019)
Collection: oib_knowledge
Shelf: basiswissen
Dokumentart: oib_guideline — OIB-Richtlinie
Page: 5
Punkt: 4.2.1
Citation: oib-rl_4_ausgabe_april_2019.pdf, p.5
Content Type: text
Relevance Score: 0.87

4.2 Absturzsicherungen
4.2.1 Die Höhe von Absturzsicherungen muss bei Absturzhöhen bis 12 m mindestens 1,00 m betragen,
bei Absturzhöhen über 12 m mindestens 1,10 m. Die Höhe ist ab der Standfläche zu messen.

## Trace-Lanes
- oib_knowledge: 1 hit
"""

_RIS_HIT = """\
Treffer 1
Titel: Wiener Bauordnung § 101 Absturzsicherungen
Dokumentnummer: LWI40000234
URL: https://www.ris.bka.gv.at/Dokumente/LrW/LWI40000234/LWI40000234.html
Auszug: Bei Absturzhöhen ab 60 cm sind Absturzsicherungen von mindestens 1,00 m Höhe anzubringen.
"""

_WEB_HIT = """\
Title: OIB-Richtlinien 2019 – Überblick
URL: https://www.oib.or.at/de/oib-richtlinien/richtlinien/2019
Snippet: Die OIB-Richtlinie 4 regelt Nutzungssicherheit und Barrierefreiheit, darunter Absturzsicherungen.
"""


@tool
def knowledge_search(query: str, file_name: str | None = None) -> str:
    return _KNOWLEDGE_HIT


@tool
def ris_search_tool(query: str) -> str:
    return _RIS_HIT


@tool
def ris_fetch_tool(document_number: str) -> str:
    return (
        "§ 101. (1) Bei Absturzhöhen ab 60 cm sind Absturzsicherungen von mindestens 1,00 m Höhe anzubringen.\n"
        "URL: https://www.ris.bka.gv.at/Dokumente/LrW/LWI40000234/LWI40000234.html\n"
    )


@tool
def web_search_tool(query: str) -> str:
    return _WEB_HIT


_TOOLS = [knowledge_search, ris_search_tool, ris_fetch_tool, web_search_tool]

_TRANSPORT_ERRORS = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)


def _research_model_name() -> str:
    block = _OIB_CONFIG.read_text(encoding="utf-8").split("research_llm:", 1)[1]
    match = re.search(r"model_name:\s*\$\{(\w+):-([^}]+)\}", block)
    if match is None:
        raise AssertionError(f"could not find research_llm.model_name in {_OIB_CONFIG}")
    env_var, default = match.group(1), match.group(2).strip()
    return os.environ.get(env_var) or default


def _build_agent(extra_tools: list = []) -> ChatAgent:  # noqa: B006 - read-only default
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model=_research_model_name(),
        base_url=_OPENROUTER_BASE_URL,
        api_key=os.environ["OPENROUTER_API_KEY"],
        temperature=1.0,
        reasoning_effort="low",
        timeout=120,
        max_retries=2,
    )
    llm = enforce_chat_request_contract(apply_openrouter_structured_defaults(llm))
    provider = LLMProvider()
    provider.set_default(llm, group=AgentGroup.RESEARCH)
    return ChatAgent(
        llm_provider=provider,
        tools=[*_TOOLS, *extra_tools],
        repair_pass=False,
    )


async def _run_turn(agent: ChatAgent, question: str, cards: CardRegistry | None = None) -> ResearchAgentState:
    for attempt in (1, 2):
        token = set_card_registry(cards) if cards is not None else None
        try:
            return await agent.run(ResearchAgentState(messages=[HumanMessage(content=question)]))
        except _TRANSPORT_ERRORS as exc:
            if attempt == 2:
                raise
            logger.warning("Transport failure on attempt 1 (%s); rerunning once", type(exc).__name__)
        finally:
            if token is not None:
                reset_card_registry(token)
    raise AssertionError("unreachable")


def _trace(result: ResearchAgentState) -> list[str]:
    return [
        traced_tool_name(call["name"], call.get("args"))
        for message in this_turn(result.messages)
        for call in getattr(message, "tool_calls", None) or []
    ]


def _data_source_calls(result: ResearchAgentState) -> list[str]:
    return [name for name in _trace(result) if name in _DATA_SOURCE_TOOL_NAMES]


def _answer_text(result: ResearchAgentState) -> str:
    content = result.messages[-1].content
    return content if isinstance(content, str) else str(content)


@pytest.fixture(autouse=True)
def _data_source_registry():
    reset_registry()
    populate_from_config(_DATA_SOURCES)
    yield
    reset_registry()


@pytest.fixture(scope="module")
def agent() -> ChatAgent:
    return _build_agent()


async def test_a_greeting_is_answered_directly_without_a_search(agent):
    result = await _run_turn(agent, "Hallo, was kannst du?")

    assert _data_source_calls(result) == [], f"a greeting searched: {_trace(result)}"
    assert result.source_lookup_attempted is False
    assert result.escalation_requested is False, result.answer_escalation_reason
    assert _answer_text(result).strip(), "a greeting produced an empty answer"


async def test_a_commissioned_report_escalates_before_any_retrieval(agent):
    result = await _run_turn(
        agent,
        "Erstelle mir einen vollständigen Prüfbericht zur Barrierefreiheit für das Projekt Musterstraße "
        "nach OIB-Richtlinie 4",
    )

    assert result.escalation_requested is True, f"no escalation; answer was: {_answer_text(result)[:400]}"
    assert result.answer_escalation_reason, "escalated without an escalation_reason"
    assert _data_source_calls(result) == [], f"a commissioned report retrieved before handing off: {_trace(result)}"


async def test_a_plain_domain_question_still_searches(agent):
    result = await _run_turn(agent, "Wie hoch muss ein Geländer bei einer Absturzhöhe von 2 m sein?")

    assert _data_source_calls(result), f"a domain question retrieved nothing; answer was: {_answer_text(result)[:400]}"
    assert result.source_lookup_attempted is True
    assert result.escalation_requested is False, result.answer_escalation_reason


def _filing_stubs(backend):
    from langchain_core.tools import StructuredTool

    from agent.tools.documents.cards import emit_draft_card
    from agent.tools.documents.register import _FILE_DRAFT_DESCRIPTION

    async def file_draft(path: str, title: str = "", submit: bool = False, reviewer: str = "") -> str:
        usage = await backend.ausage(path)
        emit_draft_card(
            path=path,
            content=getattr(usage, "content", "") or "",
            version=getattr(usage, "version", 1) or 1,
            filing={
                "grid_filed_document_id": "doc-live",
                "grid_filed_version_id": "ver-live",
                "grid_filed_state": "draft",
            },
            title=title or None,
        )
        return "Im Projekt abgelegt. Es bleibt ein Entwurf: niemand hat ihn freigegeben."

    return [
        StructuredTool.from_function(coroutine=file_draft, name="file_draft", description=_FILE_DRAFT_DESCRIPTION),
    ]


@pytest.fixture
def drafting_turn():
    from langgraph.store.memory import InMemoryStore

    from agent.tools.documents.draft_store import DraftBackend
    from agent.tools.documents.tools import draft_tools

    async def _build(case):
        backend = DraftBackend(store=InMemoryStore(), conversation_id="turn-shapes-live")
        for path, content in case.seed.items():
            await backend.awrite(path, content)
        agent = _build_agent([*draft_tools(backend), *_filing_stubs(backend)])
        return agent, CardRegistry()

    return _build


@pytest.mark.parametrize("case", DRAFTING_CASES, ids=[case.id for case in DRAFTING_CASES])
async def test_a_drafting_turn_keeps_its_shape(case, drafting_turn):
    agent, cards = await drafting_turn(case)

    result = await _run_turn(agent, case.prompt, cards)

    assert_turn_shape(
        case,
        called_tools=_trace(result),
        cards=cards.snapshot(),
        answer_meta=result.answer_meta,
        escalated=result.escalation_requested,
    )
    assert _answer_text(result).strip(), f"{case.id}: the turn produced no answer"


async def test_filing_says_the_draft_is_still_a_draft(drafting_turn):
    agent, cards = await drafting_turn(FILE)

    result = await _run_turn(agent, FILE.prompt, cards)

    answer = _answer_text(result).lower()
    assert "entwurf" in answer, f"a filed draft was not called a draft: {answer[:400]}"
