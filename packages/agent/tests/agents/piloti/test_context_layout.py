"""The conversation layout: what goes in the conversation context, what a turn keeps, how the window moves.

``context_layout`` puts what the project and the office set once after the
system prompt, stores each turn's own note with its question, and lets the
history window move only when the budget makes it. The prefix it buys is
measured in ``test_cross_turn_prefix.py``; this file holds the parts that
could break quietly: a value in the wrong part, a note the transcript loses,
a steering note at the wrong index, a window that moves every turn.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolMessage

from agent.agents.piloti import context_layout as layout_module
from agent.agents.piloti import history
from agent.agents.piloti import models
from agent.agents.piloti import prompt
from agent.common.prompt_store import PromptStore
from agent.common.steering import AppliedSteer

TOOLS = [{"name": "knowledge_search"}, {"name": "workspace__search"}, {"name": "project_lookup"}]

prompt_module = prompt
CONVERSATION_LAYOUT = layout_module.CONVERSATION_LAYOUT
LAYOUT_ENV = layout_module.LAYOUT_ENV
TURN_NOTE_KEY = layout_module.TURN_NOTE_KEY
TURN_VALUES = layout_module.TURN_VALUES
context_layout = layout_module.context_layout
conversation_request = layout_module.conversation_request
split_values = layout_module.split_values
stepped_window = layout_module.stepped_window
with_turn_notes = layout_module.with_turn_notes
written_back = layout_module.written_back
_count_message_tokens = history._count_message_tokens
ResearchAgentState = models.ResearchAgentState
render_turn_prompt = prompt.render_turn_prompt
request_messages = prompt.request_messages
system_prompt_template = prompt.system_prompt_template
turn_context_values = prompt.turn_context_values


@pytest.fixture(autouse=True)
def _bundled_prompt(monkeypatch):
    monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))


class _Day(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 4, 9, 30)


def _state() -> ResearchAgentState:
    return ResearchAgentState(
        messages=[HumanMessage(content="Und im Dachgeschoß?")],
        user_info={"name": "Anna Weber", "email": "anna@example.at", "office": "Atelier Nord"},
        project_context="name: Wohnbau\nPROJECT_MEMORY v1\n- [fact | high | unverified] GK 4",
        available_documents=[{"file_name": "Grundriss_EG.pdf", "shelf": "project"}],
        workspace_block="project: p-1",
        org_instructions="Kurz antworten.",
        reference_projects="- Wohnbau Graz (id p1): 2019",
        focus_file_name="Grundriss_EG.pdf",
        deep_research_allowed=False,
    )


class TestTheLayoutSwitch:
    def test_the_turn_layout_is_the_default(self, monkeypatch):
        monkeypatch.delenv(LAYOUT_ENV, raising=False)
        assert context_layout() == "turn"

    def test_only_its_own_name_turns_the_conversation_layout_on(self, monkeypatch):
        monkeypatch.setenv(LAYOUT_ENV, " Conversation ")
        assert context_layout() == CONVERSATION_LAYOUT
        monkeypatch.setenv(LAYOUT_ENV, "yes")
        assert context_layout() == "turn"


class TestTheTwoParts:
    def test_every_template_value_lands_in_exactly_one_part(self):
        values = turn_context_values(_state(), TOOLS)
        conversation, note = split_values(values)
        assert set(conversation) == set(values) == set(note)
        for key in values:
            if key in TURN_VALUES:
                assert note[key] == values[key], key
            else:
                assert conversation[key] == values[key], key

    def test_the_project_and_the_office_go_first_and_the_turn_stays_with_its_question(self, monkeypatch):
        monkeypatch.setenv(LAYOUT_ENV, CONVERSATION_LAYOUT)
        monkeypatch.setattr(prompt_module, "datetime", _Day)
        rendered = render_turn_prompt(system_prompt_template(), _state(), TOOLS)

        assert rendered.conversation is not None
        assert rendered.conversation.startswith("<conversation_context>")
        assert rendered.context.startswith("<turn_context>")
        for value in ("Wohnbau", "Kurz antworten.", "Wohnbau Graz", "<deep_research_off>"):
            assert value in rendered.conversation, value
            assert value not in rendered.context, value
        for value in ("2026-11-04", "Anna Weber", "p-1"):
            assert value in rendered.context, value
            assert value not in rendered.conversation, value
        assert "Date:" not in rendered.conversation

    def test_the_turn_layout_renders_one_context_as_before(self, monkeypatch):
        monkeypatch.delenv(LAYOUT_ENV, raising=False)
        monkeypatch.setattr(prompt_module, "datetime", _Day)
        rendered = render_turn_prompt(system_prompt_template(), _state(), TOOLS)
        assert rendered.conversation is None
        assert "Wohnbau" in rendered.context and "2026-11-04" in rendered.context


class TestTheRequest:
    def test_it_is_system_conversation_earlier_turns_with_their_notes_note_question(self):
        earlier = HumanMessage(content="Frage 1", id="q1", additional_kwargs={TURN_NOTE_KEY: "NOTE 1"})
        history = [earlier, AIMessage(content="Antwort 1"), HumanMessage(content="Frage 2", id="q2")]
        request = conversation_request(
            "SYSTEM", "<conversation_context>\nC\n</conversation_context>", "NOTE 2", history
        )

        assert [type(m).__name__ for m in request] == [
            "SystemMessage",
            "HumanMessage",
            "HumanMessage",
            "HumanMessage",
            "AIMessage",
            "HumanMessage",
            "HumanMessage",
        ]
        assert [m.content for m in request[2:]] == ["NOTE 1", "Frage 1", "Antwort 1", "NOTE 2", "Frage 2"]
        # The question goes out as it was sent: no note in its metadata.
        assert TURN_NOTE_KEY not in request[3].additional_kwargs

    def test_an_empty_conversation_context_sends_no_message(self):
        request = conversation_request("SYSTEM", "<conversation_context>\n\n</conversation_context>", "N", [])
        assert [m.content for m in request] == ["SYSTEM", "N"]

    def test_request_messages_takes_the_conversation_layout_from_the_prompt(self):
        prompt = prompt_module.TurnPrompt(system="SYSTEM", context="NOTE", conversation="CONV")
        request = request_messages(prompt, [HumanMessage(content="Frage")])
        assert isinstance(request[0], SystemMessage)
        assert [m.content for m in request] == ["SYSTEM", "CONV", "NOTE", "Frage"]

    def test_a_steering_note_lands_after_this_turns_message_it_arrived_behind(self):
        earlier = HumanMessage(content="Frage 1", additional_kwargs={TURN_NOTE_KEY: "NOTE 1"})
        call = AIMessage(content="", tool_calls=[{"id": "c1", "name": "knowledge_search", "args": {}}])
        history = [earlier, AIMessage(content="Antwort 1"), HumanMessage(content="Frage 2"), call]
        history.append(ToolMessage(content="result", tool_call_id="c1"))
        # Taken when the transcript held the call (index 3), so it goes right after it.
        steer = AppliedSteer(steer_id="s1", content="Bitte nur GK 4", at=4, round=1)
        request = conversation_request("SYSTEM", "CONV", "NOTE 2", history, [steer])

        contents = [m.content for m in request]
        assert contents.index("Bitte nur GK 4") == contents.index("") + 1


class TestTheWriteBack:
    def test_the_conversation_layout_stores_the_note_on_the_question_by_its_id(self, monkeypatch):
        monkeypatch.setenv(LAYOUT_ENV, CONVERSATION_LAYOUT)
        question = HumanMessage(content="Frage", id="q-7")
        answer = AIMessage(content="Antwort")
        written = written_back([], answer, [question], "NOTE", set())

        assert written[0].id == "q-7"
        assert written[0].additional_kwargs[TURN_NOTE_KEY] == "NOTE"
        assert written[-1] is answer

    def test_the_turn_layout_writes_back_what_it_always_did(self, monkeypatch):
        monkeypatch.delenv(LAYOUT_ENV, raising=False)
        question = HumanMessage(content="Frage", id="q-7")
        answer = AIMessage(content="Antwort")
        assert written_back([], answer, [question], "NOTE", set()) == [answer]

    def test_the_note_comes_back_in_front_of_its_question(self):
        stored = [HumanMessage(content="Frage", additional_kwargs={TURN_NOTE_KEY: "NOTE"}), AIMessage(content="A")]
        assert [m.content for m in with_turn_notes(stored)] == ["NOTE", "Frage", "A"]


def _turn(index: int, words: int = 600) -> list:
    call_id = f"c{index}"
    return [
        HumanMessage(content=f"Frage {index}"),
        AIMessage(content="", tool_calls=[{"id": call_id, "name": "knowledge_search", "args": {}}]),
        ToolMessage(content=" ".join(f"Abstand{j}" for j in range(words)), tool_call_id=call_id),
        AIMessage(content=f"Antwort {index}"),
    ]


def _transcript(turns: int) -> list:
    return [m for i in range(1, turns) for m in _turn(i)] + [HumanMessage(content=f"Frage {turns}")]


def _results_kept(window) -> list[str]:
    return [m.tool_call_id for m in window if isinstance(m, ToolMessage)]


class TestTheWindow:
    def test_it_keeps_every_tool_result_while_the_history_fits(self):
        transcript = _transcript(6)
        assert _results_kept(stepped_window(transcript, max_tokens=10 * _count_message_tokens(transcript))) == [
            "c1",
            "c2",
            "c3",
            "c4",
            "c5",
        ]

    def test_over_budget_it_prunes_whole_steps_of_old_turns_never_the_previous_one(self):
        transcript = _transcript(8)
        # Room for one turn's results beside what was said: turns 1-6 go, in two steps of three.
        budget = _count_message_tokens([m for m in transcript if not isinstance(m, ToolMessage)]) + 2_000
        window = stepped_window(transcript, max_tokens=budget, step=3)
        assert _results_kept(window) == ["c7"]
        assert [m.content for m in window if isinstance(m, HumanMessage)][:2] == ["Frage 1", "Frage 2"]

    def test_between_two_steps_the_window_only_grows(self):
        transcript = _transcript(6)
        budget = _count_message_tokens([m for m in transcript if not isinstance(m, ToolMessage)]) + 6_000
        before = stepped_window(transcript, max_tokens=budget, step=3)
        after = stepped_window(
            [*transcript, AIMessage(content="Antwort 6"), HumanMessage(content="Frage 7")], max_tokens=budget, step=3
        )
        assert _results_kept(before) == ["c4", "c5"]
        assert [m.content for m in after[: len(before)]] == [m.content for m in before]
