import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from agent_testing.turn_decision import SECRET
from agent_testing.turn_decision import decision_payload
from agent_testing.turn_decision import sign_payload
from agent_testing.turn_decision import signed_decision

from agent.common import bff_http
from agent.common import turn_decision
from agent.common.turn_decision import MAX_AGE_MS
from agent.common.turn_decision import bind_turn_decision
from agent.common.turn_decision import current_turn_decision
from agent.common.turn_decision import decision_missing
from agent.common.turn_decision import reset_turn_decision
from agent.common.turn_decision import verify_decision

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "apps"
    / "workspace"
    / "tests"
    / "fixtures"
    / "conversation-decision.schema.json"
)


def test_the_python_reader_takes_every_field_the_bff_contract_requires():
    schema = json.loads(FIXTURE.read_text(encoding="utf-8"))["$defs"]["conversationDecision"]
    payload = decision_payload()
    assert set(schema["required"]) == set(payload)
    assert set(schema["properties"]["may"]["required"]) == set(payload["may"])
    for field in schema["required"]:
        broken = dict(payload)
        del broken[field]
        assert verify_decision(*sign_payload(broken), SECRET) is None, field


def test_it_reads_what_the_bff_signed():
    decision = signed_decision(audienceVersion=0, solo=False, may={"workspaceRead": "document+projectFacts"})
    assert decision.audience_version == 0
    assert decision.solo is False
    assert decision.workspace_read == "document+projectFacts"
    assert decision.trace_metadata()["context.shelves"] == ["oib_knowledge"]


def test_it_refuses_a_forged_tampered_stale_or_unsigned_decision():
    header, signature = sign_payload(decision_payload())
    assert verify_decision(header, signature, "another-secret") is None
    tampered, _ = sign_payload(decision_payload(may={"personalMemory": False}))
    assert verify_decision(tampered, signature, SECRET) is None
    assert verify_decision(header, None, SECRET) is None
    assert verify_decision(header, signature, None) is None
    stale = decision_payload(issuedAt=1)
    assert verify_decision(*sign_payload(stale), SECRET, now_ms=1 + MAX_AGE_MS + 1) is None
    assert verify_decision(*sign_payload(decision_payload(kind="socket")), SECRET) is None


def test_binding_sends_the_decision_on_every_bff_call_of_the_turn(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    decision = signed_decision()
    sent: list[dict[str, str]] = []

    class _Answer:
        status = 200
        headers = {"Content-Type": "application/json"}

        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def _open(request, timeout):
        sent.append({key.lower(): value for key, value in request.header_items()})
        return _Answer()

    token = bind_turn_decision(decision)
    try:
        with patch.object(bff_http._opener, "open", side_effect=_open):
            bff_http.get_json("/api/internal/stages", timeout=1)
            bff_http.post_json("/api/internal/memory/digest", {"x": 1}, timeout=1)
    finally:
        reset_turn_decision(token)
    assert all(headers["x-turn-decision"] == decision.header for headers in sent)
    assert all(headers["x-turn-decision-signature"] == decision.signature for headers in sent)
    assert current_turn_decision() is None


def test_a_turn_without_a_decision_is_marked_missing():
    token = bind_turn_decision(None)
    try:
        assert decision_missing()
        assert current_turn_decision() is None
    finally:
        reset_turn_decision(token)
    assert not decision_missing()


ANSWER = "5a5a5a5a-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    ("conversation_id", "answer", "user", "organization", "kind", "accepted"),
    [
        ("s_conv_1", ANSWER, "user_1", "org_1", "chat", True),
        ("s_other", ANSWER, "user_1", "org_1", "chat", False),
        ("s_conv_1", "5a5a5a5a-0000-4000-8000-000000000002", "user_1", "org_1", "chat", False),
        ("s_conv_1", ANSWER, "user_2", "org_1", "chat", False),
        ("s_conv_1", ANSWER, "user_1", "org_2", "chat", False),
        ("s_conv_1", ANSWER, "user_1", "org_1", "headless", True),
        ("s_conv_1", ANSWER, "user_1", "org_1", "run", False),
        ("s_conv_1", ANSWER, "user_1", "org_1", "external", False),
    ],
)
def test_fetch_refuses_a_decision_for_another_conversation_answer_asker_organization_or_kind(
    monkeypatch, conversation_id, answer, user, organization, kind, accepted
):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    header, signature = sign_payload(decision_payload(answerMessageId=ANSWER, kind=kind))
    response = bff_http.BffResponse(
        status=200,
        content_type="application/json",
        body=json.dumps({"decision": header, "signature": signature}).encode(),
        server_timing="",
    )
    with patch.object(bff_http, "send", return_value=response) as sent:
        fetched = turn_decision.fetch_turn_decision(
            bff_http.SignedEnvelope("h", "s"),
            conversation_id=conversation_id,
            answer_message_id=answer,
            user_id=user,
            organization_id=organization,
        )
    assert sent.call_args.kwargs["body"] == {"answerMessageId": answer}
    assert (fetched is not None) is accepted


def test_the_python_enums_are_the_fixture_s():
    defs = json.loads(FIXTURE.read_text(encoding="utf-8"))["$defs"]["conversationDecision"]["properties"]
    may = defs["may"]["properties"]
    assert set(defs["kind"]["enum"]) == turn_decision._KINDS
    assert set(may["workspaceRead"]["enum"]) == turn_decision._WORKSPACE_READS
    assert set(may["otherProjects"]["properties"]["reach"]["enum"]) == turn_decision._REACHES
    assert set(may["shelves"]["items"]["properties"]["shelf"]["enum"]) == turn_decision._SHELVES


def test_it_refuses_a_key_the_contract_does_not_name():
    assert verify_decision(*sign_payload(decision_payload(extra=True)), SECRET) is None
    assert verify_decision(*sign_payload(decision_payload(may={"extra": True})), SECRET) is None


@pytest.mark.parametrize("version", [None, 0, 7])
def test_it_reads_a_null_zero_or_ordinary_audience_version(version):
    decision = signed_decision(audienceVersion=version)
    assert decision.audience_version == version
    traced = decision.trace_metadata()["context.audienceVersion"]
    assert traced == ("null" if version is None else version)


def test_the_trace_says_whether_a_decision_was_bound_and_flattens_the_features():
    traced = signed_decision(may={"features": {"deepResearch": True, "tasks": False}}).trace_metadata()
    assert traced["context.decision"] == "bound"
    assert traced["context.features"] == "deepResearch"
    assert turn_decision.MISSING_TRACE == {"context.decision": "missing"}


def test_an_expired_decision_is_no_longer_sent(monkeypatch):
    stale = signed_decision(issuedAt=int(time.time() * 1000) - MAX_AGE_MS + 1000)
    token = bind_turn_decision(stale)
    try:
        assert bff_http._current_turn_headers() == stale.headers()
        monkeypatch.setattr(time, "time", lambda: (stale.issued_at + MAX_AGE_MS + 1) / 1000)
        assert bff_http._current_turn_headers() == {}
    finally:
        reset_turn_decision(token)


def test_reset_restores_the_decision_bound_before():
    outer = signed_decision()
    inner = signed_decision(conversationId="s_inner")
    first = bind_turn_decision(outer)
    second = bind_turn_decision(inner)
    reset_turn_decision(second)
    assert current_turn_decision() is outer
    assert bff_http._current_turn_headers() == outer.headers()
    reset_turn_decision(first)


def test_fetch_answers_none_when_the_bff_cannot_decide(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    with patch.object(bff_http, "send", side_effect=bff_http.BffUnreachableError("down")):
        assert (
            turn_decision.fetch_turn_decision(
                bff_http.SignedEnvelope("h", "s"), conversation_id="c", answer_message_id=None
            )
            is None
        )
    assert turn_decision.fetch_turn_decision(None, conversation_id="c", answer_message_id=None) is None
