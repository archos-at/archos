"""The person's tape over HTTP, for the review view's measure route (ADR-0182, slice 8).

The route answers only the BFF (the internal token), only for the person a
signed, current envelope names, and the engine runs only where the BFF stated
a PDF: the entitlement it checked for that person's session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.common import turn_file_kinds
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext
from agent_host.routes import drawing_tape
from agent_host.routes.drawing_tape import DRAWING_TAPE_PATH
from agent_host.routes.drawing_tape import add_drawing_tape_routes

TOKEN = "real-secret"  # pragma: allowlist secret
#: The header the BFF sends the internal token in.
TOKEN_HEADER = "x-internal-token"
BODY = {
    "file_name": "floor.pdf",
    "collection": "p_proj_1",
    "page": 2,
    "operation": "distance",
    "points": [[0.1, 0.2], [0.3, 0.2]],
}
ANSWER = {"measurement": {"value": 4.0, "unit": "m", "low": 3.98, "high": 4.02, "provenance": "vector_estimated"}}


def _envelope(payload: dict[str, Any], secret: str = TOKEN) -> dict[str, str]:
    raw = json.dumps(payload)
    return {
        REQUEST_CONTEXT_ENVELOPE_HEADER: base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode(),
        REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest(),
    }


def _headers(**overrides: Any) -> dict[str, str]:
    payload = {"organizationId": "org_1", "userId": "user_1", "issuedAt": int(time.time() * 1000), **overrides}
    return {TOKEN_HEADER: TOKEN, **_envelope(payload)}


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    seen: list[dict[str, Any]] = []

    async def run_tape(request: Any) -> dict[str, Any]:
        if not turn_file_kinds.turn_states("pdf"):
            return {"refused": "not_enabled"}
        seen.append({"request": request.model_dump(), "user": RequestContext.from_context().user_id})
        return ANSWER

    monkeypatch.setattr(drawing_tape, "run_tape", run_tape)
    return seen


@pytest.fixture
def client(calls: list[dict[str, Any]]) -> TestClient:
    router = APIRouter()
    add_drawing_tape_routes(router)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_it_measures_for_the_person_the_envelope_names_where_the_bff_stated_a_pdf(client, calls) -> None:
    response = client.post(DRAWING_TAPE_PATH, json={**BODY, "stated_kinds": ["pdf"]}, headers=_headers())

    assert response.status_code == 200 and response.json() == ANSWER
    assert calls == [{"request": {**BODY, "points": [(0.1, 0.2), (0.3, 0.2)]}, "user": "user_1"}]
    # The statement was for that call alone.
    assert not turn_file_kinds.turn_states("pdf")


@pytest.mark.parametrize("stated", [None, [], ["ifc"]])
def test_a_call_that_states_no_pdf_is_refused(client, calls, stated) -> None:
    body = BODY if stated is None else {**BODY, "stated_kinds": stated}

    response = client.post(DRAWING_TAPE_PATH, json=body, headers=_headers())

    assert response.status_code == 403 and response.json()["detail"] == {"error": "not_enabled"}
    assert calls == []


def test_it_refuses_a_caller_without_the_internal_token(client, calls) -> None:
    headers = {key: value for key, value in _headers().items() if key != TOKEN_HEADER}

    response = client.post(DRAWING_TAPE_PATH, json={**BODY, "stated_kinds": ["pdf"]}, headers=headers)

    assert response.status_code in (401, 403) and calls == []


def test_it_refuses_a_call_without_a_signed_envelope(client, calls) -> None:
    response = client.post(DRAWING_TAPE_PATH, json={**BODY, "stated_kinds": ["pdf"]}, headers={TOKEN_HEADER: TOKEN})

    assert response.status_code == 403 and calls == []


def test_it_refuses_a_point_off_the_page(client, calls) -> None:
    body = {**BODY, "points": [[0.1, 1.2], [0.3, 0.2]], "stated_kinds": ["pdf"]}

    assert client.post(DRAWING_TAPE_PATH, json=body, headers=_headers()).status_code == 422
    assert calls == []
