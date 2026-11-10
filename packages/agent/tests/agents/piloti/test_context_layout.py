"""The conversation layout (ADR-0154): a stable head after the system prompt, the turn's note before the question.

What it has to hold: the head is the same bytes on every turn of a project
(so the provider's cache carries it), every template value is in exactly one of
the two parts (so a new value cannot land in the head unseen and rewrite it each
turn), and ``CHAT_CONTEXT_LAYOUT=turn`` is the layout from before.
"""

from __future__ import annotations

from datetime import datetime

import jinja2
import jinja2.meta
import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

from agent.agents.piloti import prompt as prompt_module
from agent.agents.piloti.context_layout import CONVERSATION_VALUES
from agent.agents.piloti.context_layout import LAYOUT_ENV
from agent.agents.piloti.context_layout import TURN_VALUES
from agent.agents.piloti.models import ResearchAgentState
from agent.agents.piloti.prompt import TurnPrompt
from agent.agents.piloti.prompt import render_turn_prompt
from agent.agents.piloti.prompt import request_messages
from agent.agents.piloti.prompt import system_prompt_template
from agent.common.prompt_caching import CACHE_CONTROL_FIELD
from agent.common.prompt_store import PromptStore

TOOLS = [{"name": "knowledge_search"}, {"name": "workspace__search"}, {"name": "project_lookup"}]
PROJECT = "name: Wohnbau\nPROJECT_MEMORY v1\n- [fact | high | unverified] GK 4"


@pytest.fixture(autouse=True)
def _bundled_prompt(monkeypatch):
    monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))
    monkeypatch.delenv(LAYOUT_ENV, raising=False)


class _Day(datetime):
    day = 1

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, cls.day, 9, 30)


def _state(question: str, **turn) -> ResearchAgentState:
    return ResearchAgentState(
        messages=[HumanMessage(content=question)],
        project_context=PROJECT,
        available_documents=[{"file_name": "Grundriss_EG.pdf", "shelf": "project"}],
        org_instructions="Kurz antworten.",
        confined=True,
        **turn,
    )


def _render(monkeypatch, day: int, state: ResearchAgentState) -> TurnPrompt:
    monkeypatch.setattr(prompt_module, "datetime", _Day)
    _Day.day = day
    return render_turn_prompt(system_prompt_template(), state, TOOLS)


def test_every_template_value_is_in_exactly_one_part():
    """A value in neither set would be rendered into both; in both, it is ambiguous."""
    template = system_prompt_template()
    read = jinja2.meta.find_undeclared_variables(jinja2.Environment().parse(template))
    read -= {"context_text", "product_name"}  # set inside the template; injected for every prompt
    # Read by ``render_prompt_template`` to build ``document_inventory``, not by the template.
    classified = (TURN_VALUES | CONVERSATION_VALUES) - {"available_documents", "in_flight_documents"}
    assert TURN_VALUES.isdisjoint(CONVERSATION_VALUES)
    assert read == classified, read ^ classified


class TestTheHeadHoldsAcrossTurns:
    def test_two_turns_of_the_project_send_the_same_head(self, monkeypatch):
        one = _render(monkeypatch, 1, _state("Wie hoch darf ich bauen?"))
        two = _render(
            monkeypatch,
            2,
            _state(
                "Und im Dachgeschoß?",
                user_info={"name": "Anna Weber"},
                focus_file_name="Grundriss_EG.pdf",
                workspace_block="project: p-1",
                reference_projects="- Wohnbau Graz (id p1): 2019",
            ),
        )
        assert one.conversation is not None
        assert one.conversation == two.conversation
        assert one.context != two.context

    def test_the_project_is_in_the_head_and_the_turn_in_the_note(self, monkeypatch):
        prompt = _render(monkeypatch, 2, _state("Frage", user_info={"name": "Anna Weber"}))
        assert prompt.conversation.startswith("<conversation_context>")
        for value in ("Wohnbau", "Grundriss_EG.pdf", "Kurz antworten.", "<restricted_conversation>"):
            assert value in prompt.conversation, value
            assert value not in prompt.context, value
        for value in ("2026-10-02", "Anna Weber"):
            assert value in prompt.context, value
            assert value not in prompt.conversation, value

    def test_files_still_being_read_are_the_turns_not_the_heads(self, monkeypatch):
        prompt = _render(monkeypatch, 1, _state("Frage", in_flight_documents=["Schnitt_AA.pdf"]))
        assert "Schnitt_AA.pdf" in prompt.context
        assert "Schnitt_AA.pdf" not in prompt.conversation

    def test_the_rollback_is_the_turn_layout(self, monkeypatch):
        monkeypatch.setenv(LAYOUT_ENV, "turn")
        prompt = _render(monkeypatch, 1, _state("Frage"))
        assert prompt.conversation is None
        assert "Wohnbau" in prompt.context


class TestTheRequest:
    PROMPT = TurnPrompt(system="SYSTEM", context="<turn_context>\nNOTE\n</turn_context>", conversation="HEAD")

    def test_the_head_follows_the_system_prompt_each_with_a_breakpoint(self):
        history = [HumanMessage(content="eins"), AIMessage(content="A"), HumanMessage(content="zwei")]
        request = request_messages(self.PROMPT, history)
        assert isinstance(request[0], SystemMessage)
        assert request[1].content == [{"type": "text", "text": "HEAD", CACHE_CONTROL_FIELD: {"type": "ephemeral"}}]
        assert request[2:4] == history[:2]
        assert request[4].content == self.PROMPT.context
        assert request[5] is history[2]

    def test_no_head_without_a_conversation_context(self):
        request = request_messages(self.PROMPT._replace(conversation=None), [HumanMessage(content="eins")])
        assert [type(m).__name__ for m in request] == ["SystemMessage", "HumanMessage", "HumanMessage"]
