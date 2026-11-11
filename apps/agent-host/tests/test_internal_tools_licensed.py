"""An office's licensed copy at the agent door: the read tools give an outside agent its place, never its text.

The door (``POST /v1/internal/tools/{name}``) runs the agent's read tools for the BFF's MCP server. It opens no
turn capture (ADR-0164), so a licensed passage the tools render reaches the outside agent listed only: the
document, the page, the clause, and a note instead of the text. These tests drive the real route with tools
that render through the real producers: ``format_results`` (what ``knowledge-search`` and ``passage-read``
answer with) and look's ``_blocks_for`` (what ``document-look`` answers with). Each has a positive control: an
unmarked passage reaches the agent whole.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from agent.common.bff_http import INTERNAL_TOKEN_HEADER
from agent.common.licensed_text import UNATTESTED_NOTE
from agent.common.licensed_text import WITHHELD_NOTE
from agent.common.licensed_text import LicenceTerms
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent_host.routes import internal_tools
from agent_host.routes.internal_tools import add_internal_tool_routes

TOKEN = "real-secret"  # pragma: allowlist secret
NORM_LINE = "| Zeile 07 | Absturzhöhe bis 23,7 m | Mindesthöhe 111 cm | Öffnungsweite höchstens 12 cm |"
ATTESTED = {"licence_class": "licensed", "ai_processing_attested": True, "quote_max_chars": 120}
UNATTESTED = {"licence_class": "licensed"}


class _Query(BaseModel):
    query: str = ""


class _Tool:
    """A read tool whose answer is rendered, inside the door's call, by ``render``."""

    input_schema = _Query

    def __init__(self, render) -> None:
        self.render = render

    async def ainvoke(self, _value: _Query) -> Any:
        return await self.render()


def _chunk(**licence: Any) -> SimpleNamespace:
    return SimpleNamespace(
        file_name="oenorm_b_1600.pdf",
        page_number=12,
        content=NORM_LINE,
        content_type=SimpleNamespace(value="text"),
        score=0.9,
        metadata={"collection": "office_org_1", "shelf": "office_shelf", "clause_id": "4.3", **licence},
    )


def _rendered(**licence: Any):
    """What knowledge-search and passage-read answer: the real renderer over one retrieved chunk."""

    async def render() -> str:
        from knowledge_layer.search import format_results

        return format_results(SimpleNamespace(success=True, chunks=[_chunk(**licence)], error_message=None), "Brüstung")

    return render


def _headers() -> dict[str, str]:
    payload = {
        "organizationId": "org_1",
        "userId": "user_1",
        "projectId": "proj_1",
        "collectionScope": [{"collection": "office_org_1", "shelf": "office_shelf"}],
        "issuedAt": int(time.time() * 1000),
    }
    raw = json.dumps(payload)
    return {
        INTERNAL_TOKEN_HEADER: TOKEN,
        REQUEST_CONTEXT_ENVELOPE_HEADER: base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode(),
        REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: hmac.new(TOKEN.encode(), raw.encode(), hashlib.sha256).hexdigest(),
    }


@pytest.fixture
def door(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    tools: dict[str, _Tool] = {}

    class Builder:
        async def get_function(self, name: str) -> _Tool:
            return tools[name]

    monkeypatch.setattr(internal_tools, "get_active_builder", lambda: Builder())
    router = APIRouter()
    add_internal_tool_routes(router)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    def call(name: str, render) -> Any:
        tools[name] = _Tool(render)
        response = client.post(
            f"/v1/internal/tools/{name}", json={"arguments": {"query": "Brüstung"}}, headers=_headers()
        )
        assert response.status_code == 200, response.text
        return response.json()["result"]

    return call


@pytest.mark.parametrize("tool", ["knowledge_search", "read_passage"])
def test_a_licensed_passage_reaches_an_outside_agent_listed_only(door, tool):
    attested = door(tool, _rendered(**ATTESTED))
    unattested = door(tool, _rendered(**UNATTESTED))

    assert NORM_LINE not in attested and WITHHELD_NOTE in attested
    assert "oenorm_b_1600.pdf" in attested and "Page: 12" in attested, "the place is the agent's to cite"
    assert NORM_LINE not in unattested and UNATTESTED_NOTE in unattested
    assert NORM_LINE in door(tool, _rendered()), "positive control: an unmarked passage reaches the agent whole"


def test_a_look_at_a_licensed_page_at_the_door_sends_no_image_and_reads_nothing(door, monkeypatch):
    from agent.common.source_kinds import Shelf
    from agent.tools.look import reading
    from agent.tools.look import register
    from agent.tools.look.place import PlaceFacts

    async def no_model(*_args, **_kwargs):
        raise AssertionError("a licensed page at the door goes to no model")

    monkeypatch.setattr(reading, "read_region", no_model)
    view = SimpleNamespace(jpeg=b"\xff\xd8page", text=NORM_LINE, region=None)
    place = PlaceFacts("oenorm_b_1600.pdf", "office_org_1", Shelf.OFFICE_SHELF, 12, None)
    licence = LicenceTerms(licence_class="licensed", ai_processing=True, quote_max_chars=120)

    async def look() -> list[dict]:
        blocks, _reading, _read = await register._blocks_for(view, "Mindesthöhe?", None, None, place, licence)
        return blocks

    result = door("look", look)

    assert all(block.get("type") == "text" for block in result), "no page image reaches an outside agent"
    text = json.dumps(result, ensure_ascii=False)
    assert NORM_LINE not in text and "licensed copy no look may read" in text
