"""The conversation layout: which value goes in the stable head, which stays with the turn.

``context_layout`` moves what the project and the office set into one message
after the system prompt and leaves what the turn varies right before the
question. The prefix that buys is measured in ``test_cross_turn_prefix.py``;
this file holds what could break quietly: a template value in neither part,
a per-question value in the head (which would rewrite it every turn), the
inventory's per-turn parts in the head, and steering notes at the wrong index.
"""

from __future__ import annotations

from datetime import datetime

import jinja2
import jinja2.meta
import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolMessage

from agent.agents.piloti import prompt as prompt_module
from agent.agents.piloti.context_layout import CONVERSATION_LAYOUT
from agent.agents.piloti.context_layout import CONVERSATION_VALUES
from agent.agents.piloti.context_layout import LAYOUT_ENV
from agent.agents.piloti.context_layout import TURN_VALUES
from agent.agents.piloti.context_layout import context_layout
from agent.agents.piloti.context_layout import conversation_request
from agent.agents.piloti.models import ResearchAgentState
from agent.agents.piloti.prompt import TurnPrompt
from agent.agents.piloti.prompt import render_turn_prompt
from agent.agents.piloti.prompt import request_messages
from agent.agents.piloti.prompt import system_prompt_template
from agent.agents.piloti.prompt import turn_context_values
from agent.common.prompt_store import PromptStore
from agent.common.source_kinds import Shelf
from agent.common.steering import AppliedSteer
from agent.knowledge.inventory import set_listing_shelf

TOOLS = [{"name": "knowledge_search"}, {"name": "workspace__search"}, {"name": "project_lookup"}]
#: Set inside the template itself (``{% set %}``), not passed in.
_TEMPLATE_LOCALS = {"context_text"}


@pytest.fixture(autouse=True)
def _bundled_prompt(monkeypatch):
    monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))


class _Day(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 4, 9, 30)


def _state(**over) -> ResearchAgentState:
    values = {
        "messages": [HumanMessage(content="Und im Dachgeschoß?")],
        "user_info": {"name": "Anna Weber", "email": "anna@example.at", "office": "Atelier Nord"},
        "project_context": "name: Mehrparteienhaus\nPROJECT_MEMORY v1\n- [fact | high | unverified] GK 4",
        "available_documents": [{"file_name": "Grundriss_EG.pdf", "shelf": "project"}],
        "workspace_block": "project: p-1",
        "org_instructions": "Kurz antworten.",
        "reference_projects": "- Wohnbau Graz (id p1): 2019",
        "focus_file_name": "Schnitt_AA.pdf",
        "deep_research_allowed": False,
    }
    return ResearchAgentState(**{**values, **over})


def _render(monkeypatch, state: ResearchAgentState) -> TurnPrompt:
    monkeypatch.setenv(LAYOUT_ENV, CONVERSATION_LAYOUT)
    monkeypatch.setattr(prompt_module, "datetime", _Day)
    return render_turn_prompt(system_prompt_template(), state, TOOLS)


class TestTheSwitch:
    def test_the_turn_layout_is_the_default(self, monkeypatch):
        monkeypatch.delenv(LAYOUT_ENV, raising=False)
        assert context_layout() == "turn"

    def test_only_its_own_name_turns_the_conversation_layout_on(self, monkeypatch):
        monkeypatch.setenv(LAYOUT_ENV, " Conversation ")
        assert context_layout() == CONVERSATION_LAYOUT
        monkeypatch.setenv(LAYOUT_ENV, "yes")
        assert context_layout() == "turn"

    def test_the_turn_layout_renders_one_context_as_before(self, monkeypatch):
        monkeypatch.delenv(LAYOUT_ENV, raising=False)
        monkeypatch.setattr(prompt_module, "datetime", _Day)
        rendered = render_turn_prompt(system_prompt_template(), _state(), TOOLS)
        assert rendered.conversation is None
        assert "Mehrparteienhaus" in rendered.context
        assert "2026-11-04" in rendered.context


class TestEveryValueIsPlacedOnPurpose:
    def test_the_two_parts_do_not_overlap(self):
        assert not TURN_VALUES & CONVERSATION_VALUES

    def test_every_value_the_template_reads_is_in_one_part(self):
        read = jinja2.meta.find_undeclared_variables(jinja2.Environment().parse(system_prompt_template()))
        unplaced = read - _TEMPLATE_LOCALS - TURN_VALUES - CONVERSATION_VALUES
        assert not unplaced, f"place each in TURN_VALUES or CONVERSATION_VALUES: {sorted(unplaced)}"

    def test_every_value_a_turn_renders_with_is_in_one_part(self):
        given = set(turn_context_values(_state(), TOOLS))
        assert given <= TURN_VALUES | CONVERSATION_VALUES, sorted(given - TURN_VALUES - CONVERSATION_VALUES)


class TestTheTwoParts:
    def test_the_project_and_the_office_go_first_and_the_turn_stays_before_its_question(self, monkeypatch):
        rendered = _render(monkeypatch, _state())

        assert rendered.conversation is not None
        assert rendered.conversation.startswith("<conversation_context>")
        assert rendered.context.startswith("<turn_context>")
        for value in ("Mehrparteienhaus", "Kurz antworten.", "Grundriss_EG.pdf", "<deep_research_off>"):
            assert value in rendered.conversation, value
            assert value not in rendered.context, value
        for value in ("2026-11-04", "Anna Weber", "p-1", "Wohnbau Graz", "Schnitt_AA.pdf"):
            assert value in rendered.context, value
            assert value not in rendered.conversation, value

    def test_the_head_is_the_same_bytes_for_another_turn_and_another_asker(self, monkeypatch):
        first = _render(monkeypatch, _state())
        second = _render(
            monkeypatch,
            _state(
                messages=[HumanMessage(content="Und die Stiege?")],
                user_info={"name": "Ben Kurz", "email": "ben@example.at"},
                workspace_block="project: p-1\ntask: t-9",
                reference_projects="- Schule Linz (id p2): 2021",
                focus_file_name=None,
            ),
        )
        assert first.conversation == second.conversation
        assert first.context != second.context

    def test_files_still_being_read_go_to_the_turn_not_the_head(self, monkeypatch):
        rendered = _render(monkeypatch, _state(in_flight_documents=["Lageplan.pdf"]))
        assert "Lageplan.pdf" in rendered.context
        assert "Lageplan.pdf" not in (rendered.conversation or "")
        assert rendered.conversation == _render(monkeypatch, _state()).conversation

    def test_a_question_that_lists_one_shelf_gets_that_shelf_in_its_note(self, monkeypatch):
        set_listing_shelf(Shelf.PROJECT)
        try:
            listed = _render(monkeypatch, _state())
        finally:
            set_listing_shelf(None)
        assert "This question asked only about" in listed.context
        assert "This question asked only about" not in (listed.conversation or "")
        assert listed.conversation == _render(monkeypatch, _state()).conversation


class TestTheRequest:
    def test_it_is_system_conversation_history_note_question(self):
        history = [HumanMessage(content="Frage 1"), AIMessage(content="Antwort 1"), HumanMessage(content="Frage 2")]
        request = conversation_request("SYSTEM", "<conversation_context>\nC\n</conversation_context>", "NOTE", history)

        assert isinstance(request[0], SystemMessage)
        assert [m.content for m in request[2:]] == ["Frage 1", "Antwort 1", "NOTE", "Frage 2"]

    def test_an_empty_conversation_context_sends_no_message(self):
        request = conversation_request("SYSTEM", "<conversation_context>\n\n</conversation_context>", "N", [])
        assert [m.content for m in request] == ["SYSTEM", "N"]

    def test_request_messages_takes_the_conversation_layout_from_the_prompt(self):
        prompt = TurnPrompt(system="SYSTEM", context="NOTE", conversation="CONV")
        request = request_messages(prompt, [HumanMessage(content="Frage")])
        assert [m.content for m in request] == ["SYSTEM", "CONV", "NOTE", "Frage"]

    def test_a_steering_note_lands_where_it_does_in_the_turn_layout(self):
        call = AIMessage(content="", tool_calls=[{"id": "c1", "name": "knowledge_search", "args": {}}])
        history = [HumanMessage(content="Frage 1"), AIMessage(content="A1"), HumanMessage(content="Frage 2"), call]
        history.append(ToolMessage(content="result", tool_call_id="c1"))
        steer = AppliedSteer(steer_id="s1", content="Bitte nur GK 4", at=4, round=1)

        turn = request_messages(TurnPrompt(system="SYSTEM", context="CTX"), history, [steer])
        conversation = request_messages(
            TurnPrompt(system="SYSTEM", context="NOTE", conversation="CONV"), history, [steer]
        )

        def before_note(request):
            contents = [m.content for m in request]
            return contents[contents.index("Bitte nur GK 4") - 1]

        assert before_note(conversation) == before_note(turn) == ""
