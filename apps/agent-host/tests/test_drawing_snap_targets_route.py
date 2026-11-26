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
from agent_host.routes import drawing_snap_targets
from agent_host.routes.drawing_snap_targets import DRAWING_SNAP_TARGETS_PATH
from agent_host.routes.drawing_snap_targets import add_drawing_snap_targets_routes

TOKEN = "real-secret"  # pragma: allowlist secret
TOKEN_HEADER = "x-internal-token"
BODY = {"file_name": "floor.pdf", "collection": "p_proj_1", "page": 2}
ANSWER = {"targets": {"versionId": "ver-1", "vertices": [0.1, 0.2], "segments": [], "scales": []}}


def _headers() -> dict[str, str]:
    raw = json.dumps({"organizationId": "org_1", "userId": "user_1", "issuedAt": int(time.time() * 1000)})
    return {
        TOKEN_HEADER: TOKEN,
        REQUEST_CONTEXT_ENVELOPE_HEADER: base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode(),
        REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: hmac.new(TOKEN.encode(), raw.encode(), hashlib.sha256).hexdigest(),
    }


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    seen: list[dict[str, Any]] = []

    async def run_snap_targets(request: Any) -> dict[str, Any]:
        if not turn_file_kinds.turn_states("pdf"):
            return {"refused": "not_enabled"}
        seen.append({"request": request.model_dump(exclude_none=True), "user": RequestContext.from_context().user_id})
        return ANSWER

    monkeypatch.setattr(drawing_snap_targets, "run_snap_targets", run_snap_targets)
    return seen


@pytest.fixture
def client(calls: list[dict[str, Any]]) -> TestClient:
    router = APIRouter()
    add_drawing_snap_targets_routes(router)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_it_lists_targets_for_the_person_the_envelope_names_where_the_bff_stated_a_pdf(client, calls) -> None:
    response = client.post(DRAWING_SNAP_TARGETS_PATH, json={**BODY, "stated_kinds": ["pdf"]}, headers=_headers())

    assert response.status_code == 200 and response.json() == ANSWER
    assert calls == [{"request": BODY, "user": "user_1"}]
    assert not turn_file_kinds.turn_states("pdf")


@pytest.mark.parametrize("stated", [None, [], ["ifc"]])
def test_a_call_that_states_no_pdf_is_refused(client, calls, stated) -> None:
    body = BODY if stated is None else {**BODY, "stated_kinds": stated}

    response = client.post(DRAWING_SNAP_TARGETS_PATH, json=body, headers=_headers())

    assert response.status_code == 403 and response.json()["detail"] == {"error": "not_enabled"}
    assert calls == []


def test_it_refuses_a_caller_without_the_internal_token_or_the_envelope(client, calls) -> None:
    without_token = {key: value for key, value in _headers().items() if key != TOKEN_HEADER}
    body = {**BODY, "stated_kinds": ["pdf"]}

    assert client.post(DRAWING_SNAP_TARGETS_PATH, json=body, headers=without_token).status_code in (401, 403)
    assert client.post(DRAWING_SNAP_TARGETS_PATH, json=body, headers={TOKEN_HEADER: TOKEN}).status_code == 403
    assert calls == []


def test_it_refuses_an_unknown_field_and_a_page_below_one(client, calls) -> None:
    for body in ({**BODY, "points": [[0.1, 0.1]]}, {**BODY, "page": 0}):
        assert client.post(DRAWING_SNAP_TARGETS_PATH, json=body, headers=_headers()).status_code == 422
    assert calls == []


def test_the_drawing_named_by_its_id_reaches_the_targets(client, calls) -> None:
    document_id = "bbbbbbbb-0000-4000-8000-00000000000b"
    body = {**BODY, "document_id": document_id, "stated_kinds": ["pdf"]}

    assert client.post(DRAWING_SNAP_TARGETS_PATH, json=body, headers=_headers()).status_code == 200
    assert str(calls[0]["request"]["document_id"]) == document_id
