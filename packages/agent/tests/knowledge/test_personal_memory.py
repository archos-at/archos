"""The personal-memory client (ADR-0180): one write, owned by the envelope, faked at the transport."""

import io
import json
import urllib.error

import pytest

from agent.common import bff_http
from agent.knowledge import personal_memory as personal
from agent.knowledge import project_memory as pm

ENVELOPE = bff_http.SignedEnvelope(header="env-header", signature="env-signature")


class _Response(io.BytesIO):
    status = 201
    headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def route(monkeypatch):
    """Install the route's answer (a body, or an HTTP error); returns what the client sent."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "internal-token")
    seen: dict = {"calls": 0}

    def install(answer=None, *, status=None, code=None):
        class _Opener:
            def open(self, request, timeout=None):  # noqa: ANN001
                seen["calls"] += 1
                seen["url"] = request.full_url
                seen["headers"] = {key.lower(): value for key, value in request.header_items()}
                seen["payload"] = json.loads(request.data.decode("utf-8"))
                if status is not None:
                    body = io.BytesIO(json.dumps({"error": "refused", "code": code}).encode("utf-8"))
                    raise urllib.error.HTTPError(request.full_url, status, "err", {}, body)
                return _Response(json.dumps(answer).encode("utf-8"))

        monkeypatch.setattr(bff_http, "_opener", _Opener())
        return seen

    return install


def _write(**overrides):
    params = {"envelope": ENVELOPE, "kind": "profile", "content": " Leads the permit phase. ", "conversation_id": "c1"}
    params.update(overrides)
    return personal.insert_personal_memory_item(**params)


def test_the_note_is_posted_with_the_envelope_and_names_no_owner(route):
    seen = route({"item": {"id": "note-1"}, "created": True})

    assert _write() == personal.PersonalMemoryWrite(id="note-1", created=True)
    assert seen["url"].endswith("/api/internal/personal-memory")
    assert seen["payload"] == {
        "kind": "profile",
        "content": "Leads the permit phase.",
        "provenanceType": "agent",
        "sourceConversationId": "c1",
    }
    assert seen["headers"][bff_http.REQUEST_CONTEXT_HEADER.lower()] == "env-header"
    assert seen["headers"][bff_http.REQUEST_CONTEXT_SIGNATURE_HEADER.lower()] == "env-signature"


def test_a_refreshed_note_says_it_was_not_created(route):
    route({"item": {"id": "note-1"}, "created": False})
    assert _write(provenance_type="distillation").created is False


def test_a_secret_is_never_sent(route):
    seen = route({"item": {"id": "note-1"}, "created": True})
    assert _write(content="The portal password is hunter2.") is None
    assert seen["calls"] == 0


def test_a_project_kind_is_a_defect_not_a_refusal(route):
    route({"item": {"id": "note-1"}, "created": True})
    with pytest.raises(ValueError, match="Invalid kind"):
        _write(kind="decision")


def test_a_temporary_conversation_raises_the_named_error(route):
    route(status=403, code="TEMPORARY_CONVERSATION")
    with pytest.raises(pm.TemporaryConversationError):
        _write()


def test_a_missing_or_invalid_envelope_is_a_refusal(route):
    route(status=401, code="UNAUTHORIZED")
    with pytest.raises(bff_http.BffRefusedError) as raised:
        _write()
    assert raised.value.status == 401


def test_an_answer_without_an_id_is_not_a_write(route):
    route({"created": True})
    with pytest.raises(bff_http.BffMalformedResponseError):
        _write()


ANSWER = "4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f"


def test_a_note_saved_in_a_turn_names_the_answer_it_was_saved_under(route):
    """So the owner's browser can show it under that answer; the note itself never rides the message."""
    seen = route({"item": {"id": "note-1"}, "created": True})
    token = pm.begin_turn_memory_log(answer_message_id=ANSWER)
    try:
        _write()
    finally:
        pm.end_turn_memory_log(token)
    assert seen["payload"]["sourceMessageId"] == ANSWER


def test_a_note_saved_outside_a_turn_names_no_answer(route):
    seen = route({"item": {"id": "note-1"}, "created": True})
    _write()
    assert "sourceMessageId" not in seen["payload"]


def test_a_personal_note_never_enters_the_ledger_the_stage_frame_is_made_of(route):
    """The frame is stored on a message other people read (ADR-0180): its ledger holds shared notes only."""
    route({"item": {"id": "note-1"}, "created": True})
    token = pm.begin_turn_memory_log(answer_message_id=ANSWER)
    try:
        _write()
        assert pm.turn_memory_notes() == ()
        # Still a write of the turn: the reflection pass must not file it again.
        assert pm.turn_memory_writes() == (" Leads the permit phase. ",)
    finally:
        pm.end_turn_memory_log(token)
