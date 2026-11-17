import time
from types import SimpleNamespace

import pytest

from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import TurnResult
from agent.common.wire_v2 import TurnTrigger
from agent.observability import answer_finished
from agent.observability import posthog_client
from agent.observability.answer_finished import TurnOrigin


def _finished(outcome: str, **result) -> RunFinishedBody:
    return RunFinishedBody(outcome=outcome, result=TurnResult(message_id="m1", text="t", **result))


def _properties(terminal, effort=None) -> dict:
    return answer_finished.answer_finished_properties(
        terminal=terminal,
        message_id="m1",
        conversation_id="c1",
        duration_ms=1234,
        origin=answer_finished.TYPED_IN_CHAT,
        effort=effort,
    )


@pytest.mark.parametrize(
    ("terminal", "outcome"),
    [
        (_finished("answered"), "ok"),
        (_finished("cancelled"), "aborted"),
        (_finished("refused"), "refused"),
        (_finished("handed_off"), "handed_off"),
        (RunErrorBody(code="workflow_error", message="m"), "error"),
    ],
)
def test_the_outcome_is_the_browser_s_answer_completed_vocabulary(terminal, outcome):
    assert _properties(terminal)["outcome"] == outcome


@pytest.mark.parametrize(
    ("headless", "trigger", "door", "source", "origin"),
    [
        (False, None, None, None, TurnOrigin("chat", "ui", None)),
        (True, "agent_consult", "mcp", "mcp", TurnOrigin("mcp", "mcp", "agent_consult")),
        (True, "agent_consult", "a2a", "script", TurnOrigin("a2a", "script", "agent_consult")),
        (True, "agent_consult", None, None, TurnOrigin(None, None, "agent_consult")),
        (True, "agent_consult", "platform", "ui", TurnOrigin(None, None, "agent_consult")),
        (True, "thread_reply", None, None, TurnOrigin("event", "ui", "thread_reply")),
        (True, "assigned", None, None, TurnOrigin("event", "ui", "assigned")),
        (True, "new_document", None, None, TurnOrigin("event", "system", "new_document")),
        (True, None, None, None, TurnOrigin(None, None, None)),
    ],
)
def test_the_origin_names_the_door_the_question_came_through(headless, trigger, door, source, origin):
    assert answer_finished.turn_origin(headless=headless, trigger=trigger, door=door, session_source=source) == origin


def test_only_a_headless_socket_s_headers_name_a_door():
    ask = TurnTrigger(kind="agent_consult", event_id="ask-1")
    headers = [(b"X-Turn-Door", b"a2a"), (b"x-turn-session-source", b"script")]
    assert answer_finished.origin_of(ask, headers, headless=True) == TurnOrigin("a2a", "script", "agent_consult")
    assert answer_finished.origin_of(ask, headers, headless=False) == TurnOrigin(None, None, "agent_consult")
    assert answer_finished.origin_of(None, headers, headless=False) == answer_finished.TYPED_IN_CHAT


def test_a_finished_turn_carries_its_effort_and_route_and_no_error_code():
    assert _properties(_finished("answered", routing_decision="deep", reasoning_effort="medium")) == {
        "outcome": "ok",
        "duration_ms": 1234,
        "message_id": "m1",
        "conversation_id": "c1",
        "effort": "medium",
        "route": "deep",
        "door": "chat",
        "session_source": "ui",
    }


def test_a_failed_turn_carries_the_wire_s_code_never_its_text():
    properties = _properties(RunErrorBody(code="auth_error", message="token_expired", details="secret"), "high")
    assert (properties["outcome"], properties["error_code"], properties["effort"]) == ("error", "auth_error", "high")
    assert "route" not in properties
    assert not {"token_expired", "secret"} & {value for value in properties.values() if isinstance(value, str)}


def _turn(terminal, **over) -> SimpleNamespace:
    wire = SimpleNamespace(terminal=terminal, conversation_id="c1", turn_id="t1")
    fields = {
        "wire": wire,
        "message_id": "m1",
        "started_at": time.monotonic() - 2,
        "origin": answer_finished.TYPED_IN_CHAT,
        "reasoning_effort": None,
        "asker_subject": "user_1",
        "organization_id": "org_1",
    }
    return SimpleNamespace(**{**fields, **over})


def test_the_report_files_the_turn_under_its_asker_and_office(monkeypatch):
    sent = []
    monkeypatch.setattr(posthog_client, "capture", lambda event, **kw: sent.append((event, kw)) or True)
    answer_finished.report_turn_finished(_turn(_finished("answered")))
    [(event, kwargs)] = sent
    assert (event, kwargs["distinct_id"], kwargs["organization_id"]) == ("answer_finished", "user_1", "org_1")
    assert kwargs["properties"]["duration_ms"] >= 2000


def test_the_report_never_raises(monkeypatch, caplog):
    def broken(event, **kwargs):
        raise RuntimeError("client down")

    monkeypatch.setattr(posthog_client, "capture", broken)
    answer_finished.report_turn_finished(_turn(_finished("answered")))
    assert "answer_finished for turn t1 was not sent" in caplog.text
