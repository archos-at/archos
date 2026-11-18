from __future__ import annotations

import contextlib
import os
from collections.abc import Mapping
from typing import Any

from fastapi import WebSocket

from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext
from agent_host.auth.middleware import detect_internal_caller
from agent_host.auth.middleware import resolve_request_user

WS_POLICY_VIOLATION = 1008
_ORG_ID_HEADER = "x-grid-organization-id"

_auth_validators: list = []
_require_auth = False
_external_hostnames: set[str] | None = None


def configure_websocket_auth(
    *,
    validators: list | None = None,
    require_auth: bool = False,
    external_hostnames: set[str] | None = None,
) -> None:
    global _auth_validators, _require_auth, _external_hostnames
    _auth_validators = list(validators or [])
    _require_auth = require_auth
    _external_hostnames = external_hostnames


async def authenticate_websocket_connection(socket: WebSocket) -> tuple[dict[str, Any] | None, int | None]:
    headers = dict(socket.scope.get("headers", []))
    user, _, is_external, _ = await resolve_request_user(
        headers,
        validators=_auth_validators,
        require_auth=_require_auth,
        external_hostnames=_external_hostnames,
    )
    if user is not None:
        return user, None
    if not is_external:
        return detect_internal_caller(headers), None
    return None, WS_POLICY_VIOLATION


def _handshake_envelope(scope: Mapping[str, Any]) -> RequestContext | None:
    headers: dict[str, str] = {}
    for raw_name, raw_value in scope.get("headers", []) or []:
        with contextlib.suppress(AttributeError, UnicodeDecodeError):
            headers[raw_name.decode("latin-1").lower()] = raw_value.decode("latin-1")
    return RequestContext.from_envelope(
        headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        os.environ.get("INTERNAL_API_TOKEN"),
    )


def handshake_conversation_binding(scope: Mapping[str, Any]) -> tuple[bool, str | None]:
    envelope = _handshake_envelope(scope)
    if envelope is None:
        return False, None
    return True, envelope.conversation_id


def _org_id_from_scope(scope: Mapping[str, Any]) -> str | None:
    for raw_name, raw_value in scope.get("headers", []) or []:
        name = raw_name.decode() if isinstance(raw_name, bytes) else str(raw_name)
        if name.lower() == _ORG_ID_HEADER:
            return raw_value.decode() if isinstance(raw_value, bytes) else str(raw_value)
    return None


def external_hostnames() -> set[str] | None:
    return _external_hostnames
