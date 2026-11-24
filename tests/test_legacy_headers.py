from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from agent_host.legacy_headers import SERVICE_HEADERS
from agent_host.legacy_headers import LegacyHeaderNamesMiddleware
from agent_host.legacy_headers import legacy_header
from agent_host.legacy_headers import with_legacy_header_names
from agent_host.legacy_headers import with_legacy_names

ROOT = Path(__file__).resolve().parents[1]
WS_PROXY = ROOT / "apps" / "workspace" / "bff" / "proxy" / "ws-upgrade-headers.js"


def test_a_renamed_header_keeps_the_name_its_readers_still_accept():
    assert legacy_header("x-chat-mode") == "x-aiq-mode"


def test_a_new_name_is_copied_onto_the_old_one():
    headers = with_legacy_names([(b"x-budget", b"new"), (b"x-request-id", b"r")])

    assert (b"x-grid-budget", b"new") in headers
    assert not any(name == b"x-grid-request-id" for name, _ in headers)


def test_an_old_name_already_sent_wins():
    headers = with_legacy_names([(b"x-organization-id", b"new"), (b"x-grid-organization-id", b"old")])

    assert [value for name, value in headers if name == b"x-grid-organization-id"] == [b"old"]


def test_a_worker_header_written_under_its_new_name_gets_the_old_one_too():
    headers = with_legacy_header_names({"x-project-id": "proj-1", "x-request-id": "r"})

    assert headers == {"x-project-id": "proj-1", "x-grid-project-id": "proj-1", "x-request-id": "r"}


def test_an_old_worker_name_the_caller_set_wins():
    headers = with_legacy_header_names({"x-project-id": "new", "x-grid-project-id": "old"})

    assert headers["x-grid-project-id"] == "old"


def test_a_reader_of_the_old_name_sees_a_header_sent_under_the_new_one():
    async def echo(request: Request) -> JSONResponse:
        return JSONResponse({"budget": request.headers.get("x-grid-budget")})

    app = Starlette(routes=[Route("/", echo)])
    app.add_middleware(LegacyHeaderNamesMiddleware)

    assert TestClient(app).get("/", headers={"x-budget": "b64"}).json() == {"budget": "b64"}


def test_the_websocket_proxy_strips_every_name_the_backend_now_reads():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    script = "process.stdout.write(JSON.stringify([...require(process.argv[1]).SERVICE_HEADERS]))"
    result = subprocess.run([node, "-e", script, str(WS_PROXY)], capture_output=True, text=True, timeout=30, check=True)

    assert set(json.loads(result.stdout)) | {"x-internal-token"} == {name.decode() for name in SERVICE_HEADERS}
