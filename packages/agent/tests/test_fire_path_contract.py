from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent_host.context_envelope import _INTERNAL_TOKEN_HEADER_NAMES
from agent_host.context_envelope import ENVELOPE_EXEMPT_HTTP_PATH_PREFIXES
from agent_host.context_envelope import _path_matches
from agent_host.jobs.runner import WORKER_ENVELOPE_HEADERS
from agent_host.jobs.runner import WORKER_IDENTITY_HEADERS
from agent_host.legacy_headers import SERVICE_HEADERS
from agent_host.legacy_headers import legacy_name
from agent_host.routes.internal_auth import _TOKEN_HEADERS
from agent_host.routes.internal_auth import _require_internal_token

REPO = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO / "apps" / "workspace" / "tests" / "fixtures" / "job_fire_headers.json"


@pytest.fixture(scope="module")
def contract() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _lower(names) -> set[str]:
    return {str(name).lower() for name in names}


def _received(names) -> set[str]:
    sent = _lower(names)
    return sent | {legacy_name(n.encode()).decode() for n in sent if n.encode() in SERVICE_HEADERS}


def test_the_route_guard_accepts_only_spellings_the_contract_names(contract: dict) -> None:
    assert _lower(_TOKEN_HEADERS) <= _received(contract["internalTokenAcceptedSpellings"])


def test_the_envelope_middleware_agrees_with_the_route_guard(contract: dict) -> None:
    middleware = _lower(name.decode("ascii") for name in _INTERNAL_TOKEN_HEADER_NAMES)
    assert middleware <= _received(contract["internalTokenAcceptedSpellings"])
    assert middleware == _lower(_TOKEN_HEADERS)


def test_what_the_route_requires_is_something_the_bff_actually_sends(contract: dict) -> None:
    required = _lower(contract["requiredOnEveryFire"])
    assert required <= _lower(contract["sentByBff"])
    assert required <= _lower(_TOKEN_HEADERS), (
        "the fire path's required header is not one the backend guard reads — this is ADR-0046's 403"
    )


def test_the_guard_admits_a_request_carrying_exactly_the_contract_headers(
    contract: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "a-real-deployment-token")
    monkeypatch.setenv("APP_ENV", "production")

    class _Request:
        def __init__(self, headers: dict[str, str]) -> None:
            self.headers = {k.lower(): v for k, v in headers.items()}

    fired = _Request({name: "a-real-deployment-token" for name in contract["requiredOnEveryFire"]})
    _require_internal_token(fired)  # must not raise

    with pytest.raises(HTTPException) as refused:
        _require_internal_token(_Request({"x-grid-organization-id": "org_1"}))
    assert refused.value.status_code == 403


def test_the_worker_identity_headers_are_the_ones_on_the_wire(contract: dict) -> None:
    worker = _lower(WORKER_IDENTITY_HEADERS)
    assert worker == {legacy_name(n.encode()).decode() for n in _lower(contract["workerIdentityHeaders"])}
    assert worker <= _received(contract["sentByBff"])


def test_the_signed_envelope_headers_match_what_the_bff_signs(contract: dict) -> None:
    envelope = _lower({REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER})
    assert envelope <= _received(contract["contextEnvelope"])
    assert envelope <= _received(contract["sentByBff"])
    assert _lower(WORKER_ENVELOPE_HEADERS) == envelope


def test_the_contract_covers_the_route_the_middleware_enforces(contract: dict) -> None:
    assert not _path_matches(contract["route"], ENVELOPE_EXEMPT_HTTP_PATH_PREFIXES)


def test_every_backend_requirement_is_inside_the_contract(contract: dict) -> None:
    named = _received(contract["sentByBff"]) | _received(contract["internalTokenAcceptedSpellings"])
    backend_requires = (
        _lower(_TOKEN_HEADERS)
        | _lower(name.decode("ascii") for name in _INTERNAL_TOKEN_HEADER_NAMES)
        | _lower(WORKER_IDENTITY_HEADERS)
        | _lower({REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER})
    )
    unnamed = sorted(backend_requires - named)
    assert unnamed == [], (
        f"the backend requires headers the contract does not name: {unnamed}. "
        "Add them to apps/workspace/tests/fixtures/job_fire_headers.json AND make the BFF send them."
    )
