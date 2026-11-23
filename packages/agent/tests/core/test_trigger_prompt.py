import base64
import hashlib
import hmac
import json

from langchain_core.messages import HumanMessage

from agent.common.wire_v2 import TurnTrigger
from agent.common.wire_v2 import UserMessage
from agent.core.models import ResearchAgentState
from agent.core.prompt import render_turn_context
from agent.core.prompt import system_prompt_template
from agent.core.prompt import trigger_block
from agent.project_context import RequestContext
from agent.turn import context as turn_context
from agent.turn.context import user_info_for
from agent.turn.payload import extract_turn_inputs

HEADING = "## Woken by"
BOUNDARY_ANCHOR = "<turn_context>"
CANVAS = [{"name": f"canvas__{tool}", "description": "x"} for tool in ("look", "mark", "reply")]
MENTION = TurnTrigger(kind="thread_mention", event_id="reply-7", annotation_id="a-1")


def _state(**fields) -> ResearchAgentState:
    return ResearchAgentState(
        messages=[HumanMessage(content="@Agent stimmt die Türbreite?")],
        user_info={"name": "Anna Weber", "email": "anna@example.at"},
        **fields,
    )


def test_a_woken_turn_renders_its_block_below_the_cache_boundary():
    rendered = render_turn_context(system_prompt_template(), _state(trigger=MENTION), CANVAS)

    assert HEADING in rendered
    assert rendered.index(BOUNDARY_ANCHOR) < rendered.index(HEADING)


def test_a_typed_turn_renders_none():
    assert HEADING not in render_turn_context(system_prompt_template(), _state(), CANVAS)


def test_it_says_who_what_and_where_to_answer():
    block = trigger_block(_state(trigger=MENTION), [tool["name"] for tool in CANVAS])

    assert "Anna Weber mentioned you in the thread of an Anmerkung" in block
    assert "`reply-7`" in block
    assert "`canvas__reply`" in block and "`a-1`" in block
    assert "do not wait" in block


def test_without_the_canvas_it_answers_in_the_reply_and_still_does_not_wait():
    block = trigger_block(_state(trigger=TurnTrigger(kind="assigned", event_id="as-1")), [])

    assert "assigned an Anmerkung to you" in block
    assert "canvas__reply" not in block
    assert "do not wait" in block


def test_the_wire_trigger_reaches_the_turn_inputs():
    message = UserMessage(conversation_id="c", message_id="m", text="?", trigger=MENTION)

    assert extract_turn_inputs(message).trigger == MENTION


def test_the_wake_jobs_author_name_reaches_the_turn_inputs():
    message = UserMessage(conversation_id="c", message_id="m", text="?", trigger=MENTION, author_name="  Anna Weber ")

    assert extract_turn_inputs(message).author_name == "Anna Weber"
    assert extract_turn_inputs(UserMessage(conversation_id="c", message_id="m", text="?")).author_name is None


def _signed_request(payload: dict) -> RequestContext:
    raw = json.dumps(payload)
    header = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    signature = hmac.new(b"trigger-secret", raw.encode(), hashlib.sha256).hexdigest()
    request = RequestContext.from_envelope(header, signature, "trigger-secret")
    assert request is not None
    return request


def test_a_woken_turn_names_the_person_from_the_signed_envelope(monkeypatch):
    monkeypatch.setattr(turn_context, "get_current_principal", lambda: None)
    request = _signed_request({"userId": "user_1", "requester": {"name": "Anna Weber", "email": "anna@example.at"}})

    block = trigger_block(
        ResearchAgentState(messages=[HumanMessage(content="?")], user_info=user_info_for(request), trigger=MENTION),
        [],
    )

    assert "Anna Weber mentioned you in the thread of an Anmerkung" in block
    assert "A person" not in block


def test_without_any_name_the_block_still_says_a_person(monkeypatch):
    monkeypatch.setattr(turn_context, "get_current_principal", lambda: None)

    block = trigger_block(
        ResearchAgentState(messages=[HumanMessage(content="?")], user_info=user_info_for(None), trigger=MENTION),
        [],
    )

    assert "A person mentioned you in the thread of an Anmerkung" in block


def test_a_question_from_a_connected_agent_names_the_door_and_answers_in_the_reply():
    trigger = TurnTrigger(kind="agent_consult", event_id="ask-1")
    block = trigger_block(_state(trigger=trigger), [tool["name"] for tool in CANVAS])

    assert "Anna Weber asked you through a connected agent" in block
    assert "`ask-1`" in block
    assert "canvas__reply" not in block
    assert "do not wait" in block


def test_a_new_document_check_says_what_woke_it_and_has_no_anmerkung():
    trigger = TurnTrigger(kind="new_document", event_id="check-1")
    block = trigger_block(_state(trigger=trigger), [tool["name"] for tool in CANVAS])

    assert "Anna Weber uploaded a new document" in block
    assert "`check-1`" in block
    assert "canvas__reply" not in block
    assert "do not wait" in block
