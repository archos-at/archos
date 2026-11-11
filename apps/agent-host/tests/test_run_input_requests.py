"""A run's question to a person, from the worker's side (ADR-0181).

Held here: the body is the route's (camel-case keys, no identity in it), a
question that the route would refuse is refused before it is sent, the answer is
read back as the BFF tells it, and no failure of the door fails a run.
"""

from __future__ import annotations

from typing import Any
from unittest import mock

import httpx
import pytest
from pydantic import ValidationError

from agent_host.jobs.run_input_requests import InputRequestAsk
from agent_host.jobs.run_input_requests import RunInputRequestClient

RUN_ID = "6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
REQUEST_ID = "0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c"
SCHEMA = {
    "type": "object",
    "properties": {"scale": {"type": "string", "enum": ["1:100", "1:200"]}},
    "required": ["scale"],
}


def _ask(**overrides: Any) -> InputRequestAsk:
    values = {
        "reason": "confirmation",
        "message": "Is 1:100 the scale of the floor plan on page 1?",
        "requestedSchema": SCHEMA,
        "idempotencyKey": "scale:page-1",
    }
    return InputRequestAsk(**{**values, **overrides})


def _view(status: str = "open", **extra: Any) -> dict[str, Any]:
    return {
        "id": REQUEST_ID,
        "runId": RUN_ID,
        "status": status,
        "reason": "confirmation",
        "message": "Is 1:100 the scale of the floor plan on page 1?",
        "requestedSchema": SCHEMA,
        "createdAt": "2026-11-11T12:00:00.000Z",
        **extra,
    }


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "service-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")


def _bff(status_code: int, body: Any, seen: list[httpx.Request]):
    """A stand-in for ``httpx.AsyncClient`` answering one fixed response."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status_code, json=body)

    def factory(*_args: Any, **_kwargs: Any) -> httpx.AsyncClient:
        return _REAL_CLIENT(transport=httpx.MockTransport(handler))

    return mock.patch("agent_host.jobs.run_input_requests.httpx.AsyncClient", factory)


_REAL_CLIENT = httpx.AsyncClient


class TestTheBody:
    def test_it_is_the_routes_own_shape_and_names_nobody(self):
        wire = _ask().to_wire()
        assert set(wire) == {"reason", "message", "requestedSchema", "idempotencyKey"}
        assert wire["requestedSchema"] == SCHEMA

    @pytest.mark.parametrize(
        "overrides",
        [
            {"message": ""},
            {"message": "x" * 2_001},
            {"reason": "tool_call"},
            {"idempotencyKey": "has space"},
            {"requestedSchema": {"type": "object", "properties": {}}},
            {"requestedSchema": {"type": "object", "properties": {"place": {"type": "object"}}}},
            {"requestedSchema": {"type": "object", "properties": {"Scale": {"type": "string"}}}},
            {"requestedSchema": {**SCHEMA, "required": ["missing"]}},
            {"runId": RUN_ID},
        ],
    )
    def test_a_question_the_route_would_refuse_is_refused_here(self, overrides):
        with pytest.raises(ValidationError):
            _ask(**overrides)


class TestTheDoor:
    async def test_asking_posts_to_the_runs_own_path_with_the_service_token(self):
        seen: list[httpx.Request] = []
        with _bff(200, _view(), seen):
            view = await RunInputRequestClient().ask(RUN_ID, _ask())
        assert view is not None and view.id == REQUEST_ID and not view.settled
        assert seen[0].method == "POST"
        assert str(seen[0].url) == f"http://frontend:3000/api/internal/runs/{RUN_ID}/input-requests"
        assert seen[0].headers["X-Internal-Token"] == "service-token"

    async def test_reading_brings_the_answer_back(self):
        seen: list[httpx.Request] = []
        with _bff(200, _view("answered", content={"scale": "1:200"}, decidedBy="user_1"), seen):
            view = await RunInputRequestClient().read(RUN_ID, REQUEST_ID)
        assert view is not None and view.settled
        assert view.content == {"scale": "1:200"} and view.decided_by == "user_1"
        assert str(seen[0].url).endswith(f"/input-requests/{REQUEST_ID}")

    @pytest.mark.parametrize("status", ["declined", "cancelled", "expired"])
    async def test_every_other_ending_stops_the_wait_without_an_answer(self, status):
        with _bff(200, _view(status), []):
            view = await RunInputRequestClient().read(RUN_ID, REQUEST_ID)
        assert view is not None and view.settled and view.content is None

    async def test_a_refusal_an_unreadable_body_and_a_dead_door_fail_no_run(self):
        with _bff(409, {"error": "This run has already ended"}, []):
            assert await RunInputRequestClient().ask(RUN_ID, _ask()) is None
        with _bff(200, {"unexpected": True}, []):
            assert await RunInputRequestClient().read(RUN_ID, REQUEST_ID) is None

        def boom(*_args: Any, **_kwargs: Any):
            raise httpx.ConnectError("no route to host")

        with mock.patch("agent_host.jobs.run_input_requests.httpx.AsyncClient", boom):
            assert await RunInputRequestClient().ask(RUN_ID, _ask()) is None

    async def test_without_a_door_nothing_is_sent(self, monkeypatch):
        monkeypatch.delenv("INTERNAL_API_TOKEN")
        seen: list[httpx.Request] = []
        with _bff(200, _view(), seen):
            assert await RunInputRequestClient().ask(RUN_ID, _ask()) is None
        assert seen == []
