"""What a turn sends again, byte for byte, and what it sends new.

A provider caches the prefix of a request: the tool schemas, then the system
prompt, then the messages. Within a turn every round extends the one before,
so the rounds hit. Across turns, and across conversations, the cache carries
only as far as the new request repeats an earlier one. This drives
conversations through the code that builds the requests (``history_window``,
``request_messages``, ``conversation._answer_update``) in both context layouts
and measures two things:

* a follow-up: the new characters on its first call (what the turn pays at
  the full input price), against the previous turn's last request;
* an opening turn: how much of its first call another conversation of the
  same project already sent.

Measured 2026-11-04, sizes as below. The turn layout repeats the tool schemas,
the system prompt and the history up to the question before last; the turn
context after it, the bulk of a request, is new on every turn and in every
conversation. The conversation layout moves the project's part of that context
to the head: the follow-up's new characters drop by about two thirds, and an
opening turn shares the head with the project's other conversations. It adds
nothing to what the history carries, so the reads every round repeats stay as
they were.

History edits are measured the same way: a conversation that outgrows its
history budget, with older turns pruned and the window moved in steps
(``history.PRUNE_BATCH_TURNS``, ``history.TRIM_TO_SHARE``) against the same
conversation edited on every turn.

The floors are ratchets: a change that sends more new characters, or shares
less, fails; one that does better lowers or raises them. Ported from the
unmerged ``feat/chat-conversation-context-layout`` branch (ADR-0154), where it
was first measured on 2026-11-04.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage

from agent.agents.piloti import history as history_module
from agent.agents.piloti.context_layout import CONVERSATION_LAYOUT
from agent.agents.piloti.context_layout import TURN_LAYOUT
from agent.agents.piloti.conversation import _answer_update
from agent.agents.piloti.history import history_window
from agent.agents.piloti.models import ResearchAgentState
from agent.agents.piloti.prompt import TurnPrompt
from agent.agents.piloti.prompt import request_messages
from agent.common.message_utils import content_to_text

#: The bound tool schemas, ahead of every message (the IFC tools alone are about 8 k tokens).
TOOL_SCHEMAS = "T" * 40_000
SYSTEM = "S" * 20_000
#: What the project and the office set: the inventory, the project, the office.
PROJECT = "Inventar-Zeile " * 1_800
HISTORY_BUDGET = 40_000


def _note(conversation: str, turn: int) -> str:
    """What a turn varies: the date, the asker, the open file, the workspace."""
    return f"Date: 2026-11-04\nUser: {conversation}\nFocus: Plan {turn}.pdf\n" + ("Arbeitsstand " * 150)


def _prompt(layout: str, conversation: str, turn: int) -> TurnPrompt:
    note = _note(conversation, turn)
    if layout == TURN_LAYOUT:
        return TurnPrompt(system=SYSTEM, context=f"<turn_context>\n{note}{PROJECT}\n</turn_context>")
    return TurnPrompt(
        system=SYSTEM,
        context=f"<turn_context>\n{note}\n</turn_context>",
        conversation=f"<conversation_context>\n{PROJECT}\n</conversation_context>",
    )


def _results(turn: int, cited: str) -> str:
    """A knowledge_search result in the grounding grammar: three passages, one of them cited."""
    return "".join(
        f"--- Result {index} ---\nSource: OIB-RL 2\nCitation: {key}\n\n" + (f"Passage {key} " * 300) + "\n\n"
        for index, key in enumerate((cited, f"T{turn}-B", f"T{turn}-C"), start=1)
    )


def _run_turn(
    transcript: list[BaseMessage], layout: str, conversation: str, turn: int, budget: int = HISTORY_BUDGET
) -> tuple[list[list[BaseMessage]], list[BaseMessage]]:
    """One turn: two search rounds and an answer, then the write-back. Returns its requests and the new transcript."""
    stored = [*transcript, HumanMessage(content=f"Frage {turn}: Abstand zur Grundgrenze?")]
    history = history_window(stored, budget)
    prompt = _prompt(layout, conversation, turn)
    messages = list(history)
    requests = []
    for round_index in range(2):
        requests.append(request_messages(prompt, messages))
        call_id = f"call-{turn}-{round_index}"
        messages.append(
            AIMessage(content="", tool_calls=[{"id": call_id, "name": "knowledge_search", "args": {"q": turn}}])
        )
        messages.append(ToolMessage(content=_results(turn, f"T{turn}-R{round_index}"), tool_call_id=call_id))
    requests.append(request_messages(prompt, messages))
    answer = AIMessage(content=f"Antwort {turn} [1] " * 200)
    result = ResearchAgentState(
        messages=[*messages, answer],
        verified_sources=[{"citation_key": f"T{turn}-R0"}, {"citation_key": f"T{turn}-R1"}],
    )
    update = _answer_update(answer, result, messages[len(history) :])
    return requests, [*stored, *update["messages"]]


def _conversation(
    layout: str, turns: int, name: str = "A", budget: int = HISTORY_BUDGET
) -> list[list[list[BaseMessage]]]:
    transcript: list[BaseMessage] = []
    played = []
    for turn in range(1, turns + 1):
        requests, transcript = _run_turn(transcript, layout, name, turn, budget)
        played.append(requests)
    return played


def _wire(message: BaseMessage) -> str:
    """What the provider sees of one message, close enough to compare prefixes."""
    calls = "".join(f"{c['id']}{c['name']}{c['args']}" for c in getattr(message, "tool_calls", None) or [])
    return f"<{message.type}:{getattr(message, 'tool_call_id', '')}>{content_to_text(message.content)}{calls}"


def _text(request: list[BaseMessage]) -> str:
    return TOOL_SCHEMAS + "".join(_wire(message) for message in request)


def _shared(before: list[BaseMessage], after: list[BaseMessage]) -> int:
    old, new = _text(before), _text(after)
    shared = 0
    for a, b in zip(old, new, strict=False):
        if a != b:
            break
        shared += 1
    return shared


def _new_on_follow_up(layout: str, turns: int) -> int:
    """The characters the last turn's first call sends that the turn before did not."""
    played = _conversation(layout, turns)
    before, first = played[-2][-1], played[-1][0]
    return len(_text(first)) - _shared(before, first)


def _shared_by_another_conversation(layout: str) -> float:
    """The share of an opening turn's first call that another conversation of the project already sent."""
    first_a = _conversation(layout, 1, "A")[0][0]
    first_b = _conversation(layout, 1, "B")[0][0]
    return _shared(first_a, first_b) / len(_text(first_b))


@pytest.mark.parametrize("turns", [2, 3, 5])
def test_a_follow_up_in_the_conversation_layout_sends_a_third_of_the_new_text(turns):
    turn = _new_on_follow_up(TURN_LAYOUT, turns)
    conversation = _new_on_follow_up(CONVERSATION_LAYOUT, turns)
    print(f"new characters on follow-up {turns}: turn layout {turn}, conversation layout {conversation}")
    assert conversation <= 0.40 * turn


def test_another_conversation_of_the_project_shares_the_head():
    turn = _shared_by_another_conversation(TURN_LAYOUT)
    conversation = _shared_by_another_conversation(CONVERSATION_LAYOUT)
    print(f"opening turn shared with another conversation: turn layout {turn:.1%}, conversation {conversation:.1%}")
    assert turn < 0.70
    assert conversation >= 0.90


def test_the_conversation_layout_sends_no_more_than_the_turn_layout():
    for turn_requests, conversation_requests in zip(
        _conversation(TURN_LAYOUT, 5), _conversation(CONVERSATION_LAYOUT, 5), strict=True
    ):
        for turn_request, conversation_request in zip(turn_requests, conversation_requests, strict=True):
            # The same parts in another order, plus two tags: never more to read on any round.
            assert len(_text(conversation_request)) <= len(_text(turn_request)) + 64


#: Small enough that sixteen turns outgrow it, so the window has to move.
LONG_BUDGET = 9_000


def _carried_follow_ups(turns: int) -> float:
    """The share of follow-ups whose first call repeats the previous turn past the head and the oldest kept turn."""
    played = _conversation(CONVERSATION_LAYOUT, turns, budget=LONG_BUDGET)
    head = len(_text(played[0][0][:2]))
    carried = 0
    for before, after in zip(played, played[1:], strict=False):
        carried += _shared(before[-1], after[0]) > head + 2_000
    return carried / (len(played) - 1)


def test_history_edited_in_batches_carries_most_follow_ups(monkeypatch):
    batched = _carried_follow_ups(16)
    monkeypatch.setattr(history_module, "PRUNE_BATCH_TURNS", 1)
    monkeypatch.setattr(history_module, "TRIM_TO_SHARE", 1.0)
    every_turn = _carried_follow_ups(16)
    print(f"follow-ups that carry their history: batched {batched:.0%}, edited every turn {every_turn:.0%}")
    assert batched >= 0.6
    assert batched >= every_turn + 0.3
