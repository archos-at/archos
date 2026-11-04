"""How much of a conversation's last request the next turn sends again, byte for byte.

A provider caches a request's prefix. Within a turn every round extends the one
before, so the rounds hit. Across turns the cache carries only as far as the
next turn's first request repeats the previous turn's last one. This drives a
three-turn conversation through the code that builds those requests
(``history.history_window``, ``prompt.request_messages`` and the write-back in
``conversation._answer_update``) and measures that shared prefix.

Measured 2026-11-04 on the turn-context layout: the next turn repeats the system
prompt and the turns before the previous question, and nothing after them. The
previous question was sent behind a turn context the transcript does not keep,
the previous turn's results are written back compacted, and the turn before
that loses its tool calls. In production the first call of a follow-up turn was
as large as an opening turn's (p50 39.8 k against 37.1 k prompt tokens), and
hours with five or more turns by one person reached a 72 % cache share where a
carried prefix would give about 86 %.

The floor below is a ratchet: it records what the layout carries today, so a
change that carries less fails, and a change that carries more raises it.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langgraph.graph.message import add_messages

from agent.agents.piloti import context_layout as layout_module
from agent.agents.piloti import conversation
from agent.agents.piloti import models
from agent.agents.piloti import prompt

SYSTEM = "S" * 20_000
#: What the project and the office set, as large as production's: the inventory, the project, the office.
STABLE = "Inventar-Zeile " * 1_800
HISTORY_BUDGET = 40_000

CONVERSATION_LAYOUT = layout_module.CONVERSATION_LAYOUT
LAYOUT_ENV = layout_module.LAYOUT_ENV
TURN_LAYOUT = layout_module.TURN_LAYOUT
conversation_window = layout_module.conversation_window
_answer_update = conversation._answer_update
ResearchAgentState = models.ResearchAgentState
TurnPrompt = prompt.TurnPrompt
request_messages = prompt.request_messages


def _note(turn: int) -> str:
    """What a turn varies: the date, the open file, the workspace."""
    return f"Date: 2026-11-04\nFocus: Plan {turn}.pdf\n" + ("Arbeitsstand " * 150)


def _prompt(turn: int, layout: str) -> TurnPrompt:
    """The prompt of one turn in ``layout``: one turn context, or a conversation context and a note."""
    if layout == TURN_LAYOUT:
        return TurnPrompt(system=SYSTEM, context=f"<turn_context>\n{_note(turn)}{STABLE}\n</turn_context>")
    return TurnPrompt(
        system=SYSTEM,
        context=f"<turn_context>\n{_note(turn)}\n</turn_context>",
        conversation=f"<conversation_context>\n{STABLE}\n</conversation_context>",
    )


def _results(turn: int, cited: str) -> str:
    """A knowledge_search result in the grounding grammar: three passages, one of them cited."""
    blocks = []
    for index, key in enumerate((cited, f"T{turn}-B", f"T{turn}-C"), start=1):
        blocks.append(
            f"--- Result {index} ---\nSource: OIB-RL 2\nCitation: {key}\n\n" + (f"Passage {key} " * 300) + "\n\n"
        )
    return "".join(blocks)


@dataclass
class Turn:
    first_request: list[BaseMessage]
    last_request: list[BaseMessage]


def _run_turn(transcript: list[BaseMessage], turn: int, layout: str) -> tuple[Turn, list[BaseMessage]]:
    """One turn: two search rounds and an answer, then the write-back. Returns the requests and the new transcript."""
    question = HumanMessage(content=f"Frage {turn}: Abstand zur Grundgrenze?", id=f"question-{turn}")
    stored = add_messages(transcript, [question])
    history = conversation_window(stored, HISTORY_BUDGET)
    prompt = _prompt(turn, layout)

    messages = list(history)
    requests = []
    for round_index in range(2):
        requests.append(request_messages(prompt, messages))
        call_id = f"call-{turn}-{round_index}"
        messages.append(
            AIMessage(
                content="",
                tool_calls=[{"id": call_id, "name": "knowledge_search", "args": {"query": f"q{turn}{round_index}"}}],
            )
        )
        messages.append(ToolMessage(content=_results(turn, f"T{turn}-R{round_index}"), tool_call_id=call_id))
    requests.append(request_messages(prompt, messages))

    answer = AIMessage(content=f"Antwort {turn} [1] " * 200)
    turn_messages = messages[len(history) :]
    result = ResearchAgentState(
        messages=[*messages, answer],
        verified_sources=[{"citation_key": f"T{turn}-R0"}, {"citation_key": f"T{turn}-R1"}],
        cached_turn_context=prompt.context,
    )
    update = _answer_update(answer, result, turn_messages)
    # The conversation's reducer: a message whose id is already stored replaces it in place.
    return Turn(first_request=requests[0], last_request=requests[-1]), add_messages(stored, update["messages"])


def _wire(message: BaseMessage) -> str:
    """What the provider sees of one message, close enough to compare prefixes."""
    calls = getattr(message, "tool_calls", None) or []
    call_text = "".join(f"{c['id']}{c['name']}{c['args']}" for c in calls)
    return f"<{message.type}:{getattr(message, 'tool_call_id', '')}>{message.content}{call_text}"


def _shared_prefix_chars(before: list[BaseMessage], after: list[BaseMessage]) -> int:
    shared = 0
    for old, new in zip(before, after, strict=False):
        old_text, new_text = _wire(old), _wire(new)
        if old_text == new_text:
            shared += len(new_text)
            continue
        common = 0
        for a, b in zip(old_text, new_text, strict=False):
            if a != b:
                break
            common += 1
        return shared + common
    return shared


def _carry(before: Turn, after: Turn) -> float:
    """The share of the next turn's first request that the previous turn's last request already sent."""
    total = sum(len(_wire(message)) for message in after.first_request)
    return _shared_prefix_chars(before.last_request, after.first_request) / total


def _conversation(turns: int, layout: str, monkeypatch: pytest.MonkeyPatch) -> list[Turn]:
    monkeypatch.setenv(LAYOUT_ENV, layout)
    transcript: list[BaseMessage] = []
    played = []
    for turn in range(1, turns + 1):
        result, transcript = _run_turn(transcript, turn, layout)
        played.append(result)
    return played


#: What the turn layout carries from turn 2 to turn 3: 30.9 % (measured 2026-11-04).
TURN_LAYOUT_FLOOR = 0.30
#: What the conversation layout carries from one turn to the next: 84.7 % into turn 2, then 87 to 92 %
#: (measured 2026-11-04). The first follow-up carries least: the history behind it is shortest.
CONVERSATION_LAYOUT_FLOOR = 0.80


def test_a_follow_up_repeats_at_least_what_the_turn_layout_carries_today(monkeypatch):
    turns = _conversation(3, TURN_LAYOUT, monkeypatch)
    carry = _carry(turns[1], turns[2])
    print(f"turn layout, cross-turn carry 2 -> 3: {carry:.1%}")
    assert carry >= TURN_LAYOUT_FLOOR


@pytest.mark.parametrize("turns", [2, 3, 4, 5, 6, 7])
def test_in_the_conversation_layout_each_follow_up_repeats_the_turn_before(monkeypatch, turns):
    played = _conversation(turns, CONVERSATION_LAYOUT, monkeypatch)
    carry = _carry(played[-2], played[-1])
    print(f"conversation layout, cross-turn carry {turns - 1} -> {turns}: {carry:.1%}")
    assert carry >= CONVERSATION_LAYOUT_FLOOR


@pytest.mark.parametrize("layout", [TURN_LAYOUT, CONVERSATION_LAYOUT])
def test_the_system_prompt_always_carries(monkeypatch, layout):
    turns = _conversation(2, layout, monkeypatch)
    assert _shared_prefix_chars(turns[0].last_request, turns[1].first_request) >= len(_wire(turns[1].first_request[0]))
