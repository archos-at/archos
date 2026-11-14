"""The memory frame is stored on its answer by the agent tier, not only by an attached browser.

The defect: the frame became durable only when a browser still held the
conversation's socket when the stage ended. A person who opened another chat
three seconds before a 45-second stage finished had the note saved and never
saw it under the answer, also after a reload (post-answer-stages §11 risk 3).
"""

import asyncio
import dataclasses
import io
import json
import urllib.error
from unittest.mock import patch

import pytest

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope
from agent.knowledge.project_memory import TurnMemoryNote
from agent.stages import durable_frame
from agent.stages.memory_reflection import MEMORY_REFLECTION
from agent.stages.spec import StageContext
from agent.stages.spec import TurnFacts
from agent.turn.response import answer_message_id

ENVELOPE = SignedEnvelope(header="eyJjb250ZXh0Ijp7fX0", signature="c2lnbmF0dXJl")
ANSWER_ID = answer_message_id("conv_1", "msg_1")
PAYLOAD = {"items": [{"id": "n-1", "kind": "decision", "content": "Flachdach.", "provenance": "agent"}]}


class _Response(io.BytesIO):
    status = 200
    headers: dict[str, str] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def _ok() -> _Response:
    return _Response(json.dumps({"id": ANSWER_ID}).encode("utf-8"))


def _refused(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("http://frontend:3000/x", status, "refused", {}, io.BytesIO(b"{}"))


class _Bff:
    """The BFF's answers to the stage route, in turn; every other route (the profiler's spans) answers 200."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, request, *args, **kwargs):
        if not request.full_url.endswith("/stages"):
            return _ok()
        self.requests.append(request)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer()


def _facts(**overrides) -> TurnFacts:
    base = TurnFacts(
        conversation_id="conv_1",
        ws_parent_id="msg_1",
        organization_id="org_1",
        project_id="proj_1",
        query="Welches Dach?",
        answer="Ein Flachdach.",
        routing_decision="meta",
        envelope=ENVELOPE,
        enabled_stages=frozenset({"memory_reflection"}),
    )
    return dataclasses.replace(base, **overrides)


@pytest.fixture(autouse=True)
def _wiring(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")

    async def _no_wait(_seconds):
        return None

    monkeypatch.setattr(durable_frame, "_sleep", _no_wait)


async def _write() -> tuple[int, str]:
    return await durable_frame.write_durable_frame(_facts(), "memory_reflection", ANSWER_ID, PAYLOAD)


class TestTheWrite:
    @pytest.mark.asyncio
    async def test_it_patches_the_answer_with_the_stage_and_the_turns_envelope(self):
        bff = _Bff(_ok)
        with patch.object(bff_http._opener, "open", side_effect=bff):
            attempts, reason = await _write()
        assert (attempts, reason) == (1, "stored")
        [request] = bff.requests
        assert request.get_method() == "PATCH"
        assert request.full_url == f"http://frontend:3000/api/internal/conversations/conv_1/messages/{ANSWER_ID}/stages"
        assert json.loads(request.data) == {"stage": "memory_reflection", "payload": PAYLOAD}
        sent = {key.lower(): value for key, value in request.header_items()}
        assert sent["x-request-context"] == ENVELOPE.header
        assert sent["x-request-context-sig"] == ENVELOPE.signature

    @pytest.mark.asyncio
    async def test_it_waits_for_the_answer_row_and_then_stores(self):
        """The agent host persists the answer in the background, possibly after the stage."""
        bff = _Bff(_refused(404), _refused(404), _ok)
        with patch.object(bff_http._opener, "open", side_effect=bff):
            attempts, reason = await _write()
        assert (attempts, reason, len(bff.requests)) == (3, "stored", 3)

    @pytest.mark.asyncio
    async def test_it_gives_up_quietly_with_a_named_reason_when_the_answer_never_appears(self):
        with patch.object(bff_http._opener, "open", side_effect=_Bff(_refused(404))):
            attempts, reason = await _write()
        assert (attempts, reason) == (len(durable_frame.RETRY_DELAYS_S) + 1, "answer_not_found")

    @pytest.mark.asyncio
    async def test_any_other_refusal_is_final(self):
        bff = _Bff(_refused(400))
        with patch.object(bff_http._opener, "open", side_effect=bff):
            assert await durable_frame.write_durable_frame(_facts(), "memory_reflection", ANSWER_ID, PAYLOAD) == (
                1,
                "refused_400",
            )
        assert len(bff.requests) == 1

    @pytest.mark.asyncio
    async def test_without_an_envelope_or_a_turn_nothing_is_sent(self):
        bff = _Bff(_ok)
        with patch.object(bff_http._opener, "open", side_effect=bff):
            assert durable_frame.schedule_durable_frame(_facts(envelope=None), "memory_reflection", PAYLOAD) is None
            assert durable_frame.schedule_durable_frame(_facts(ws_parent_id=None), "memory_reflection", PAYLOAD) is None
        assert bff.requests == []


class TestTheStage:
    @pytest.mark.asyncio
    async def test_in_turn_notes_on_a_declined_reflection_are_stored_on_the_answer_too(self):
        """The gate proceeds with no model call for a turn with in-turn notes: the same write applies."""
        note = TurnMemoryNote(id="n-1", kind="decision", content="Flachdach.", scope="project")
        with (
            patch("agent.memory.reflection.run_memory_reflection") as run,
            patch.object(bff_http._opener, "open", side_effect=(bff := _Bff(_ok))),
        ):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(noted_this_turn=(note,)), llm=object()))
            await asyncio.gather(*durable_frame._pending)
        run.assert_not_called()
        [request] = bff.requests
        assert json.loads(request.data) == {"stage": "memory_reflection", "payload": payload}

    @pytest.mark.asyncio
    async def test_a_failing_write_neither_fails_nor_delays_the_stage(self):
        note = TurnMemoryNote(id="n-1", kind="decision", content="Flachdach.", scope="project")
        with patch.object(bff_http._opener, "open", side_effect=_Bff(OSError("connection refused"))):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(noted_this_turn=(note,)), llm=object()))
            assert payload["items"][0]["id"] == "n-1"
            reasons = await asyncio.gather(*durable_frame._pending)
        assert reasons == ["unreachable"]
