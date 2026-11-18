from __future__ import annotations

import hmac
import json
import logging
import os
from typing import Any

from starlette.types import ASGIApp
from starlette.types import Receive
from starlette.types import Scope
from starlette.types import Send

from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext

from .auth.middleware import _load_external_hostnames
from .auth.middleware import resolve_request_user
from .legacy_headers import legacy_name

logger = logging.getLogger(__name__)

ENVELOPE_EXEMPT_HTTP_PATH_PREFIXES: tuple[str, ...] = (
    "/health",
    "/v1/collections",
    "/v1/documents",
    "/v1/data_sources",
    "/v1/jobs/async/agents",
    "/v1/jobs/async/job",
    "/v1/jobs/async/jobs",
    "/v1/drafts",
)
ENVELOPE_EXEMPT_WEBSOCKET_PATH_PREFIXES: tuple[str, ...] = ()

_WS_POLICY_VIOLATION = 1008

_INTERNAL_TOKEN_HEADER_NAMES: tuple[bytes, ...] = (legacy_name(b"x-internal-token"), b"x-internal-token")


def _path_matches(path: str, prefixes: tuple[str, ...]) -> bool:
    for prefix in prefixes:
        if path == prefix or path.startswith(f"{prefix}/"):
            return True
    return False


def _header(headers: dict[bytes, bytes], name: str) -> str | None:
    raw = headers.get(name.encode("ascii"))
    if raw is None:
        return None
    return raw.decode("utf-8", errors="replace")


def _is_internal_token_call(headers: dict[bytes, bytes]) -> bool:
    secret = os.environ.get("INTERNAL_API_TOKEN")
    if not secret:
        return False
    for name in _INTERNAL_TOKEN_HEADER_NAMES:
        provided = headers.get(name)
        if provided is not None and hmac.compare_digest(provided.decode("utf-8", errors="replace"), secret):
            return True
    return False


def _has_valid_envelope(headers: dict[bytes, bytes]) -> bool:
    envelope = _header(headers, REQUEST_CONTEXT_ENVELOPE_HEADER)
    sig = _header(headers, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER)
    secret = os.environ.get("INTERNAL_API_TOKEN")
    return RequestContext.from_envelope(envelope, sig, secret) is not None


class RequestContextEnvelopeMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        require_auth: bool = False,
        validators: list | None = None,
        external_hostnames: set[str] | None = None,
        exempt_http_path_prefixes: tuple[str, ...] = ENVELOPE_EXEMPT_HTTP_PATH_PREFIXES,
        exempt_websocket_path_prefixes: tuple[str, ...] = ENVELOPE_EXEMPT_WEBSOCKET_PATH_PREFIXES,
    ) -> None:
        self.app = app
        self._require_auth = require_auth
        self._validators: list = validators or []
        self._external_hostnames: set[str] = (
            external_hostnames if external_hostnames is not None else _load_external_hostnames()
        )
        self._exempt_http = tuple(exempt_http_path_prefixes)
        self._exempt_websocket = tuple(exempt_websocket_path_prefixes)
        logger.info(
            "RequestContextEnvelopeMiddleware: require_auth=%s exempt_http=%s exempt_websocket=%s",
            require_auth,
            self._exempt_http,
            self._exempt_websocket,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope.get("type")
        if scope_type not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if not self._require_auth:
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        exempt = self._exempt_http if scope_type == "http" else self._exempt_websocket
        if _path_matches(path, exempt):
            await self.app(scope, receive, send)
            return

        headers: dict[bytes, bytes] = dict(scope.get("headers") or [])

        if scope_type == "http":
            state = scope.get("state") or {}
            user: dict[str, Any] = state.get("user") or {}
        else:
            user, _status, _is_external, _err = await resolve_request_user(
                headers,
                validators=self._validators,
                require_auth=self._require_auth,
                external_hostnames=self._external_hostnames,
            )
            user = user or {}

        if user.get("type") != "jwt":
            await self.app(scope, receive, send)
            return

        if _is_internal_token_call(headers):
            await self.app(scope, receive, send)
            return

        if _has_valid_envelope(headers):
            await self.app(scope, receive, send)
            return

        logger.warning(
            "Rejecting %s %s: authenticated request missing a valid X-Grid-Request-Context envelope",
            scope_type,
            path,
        )
        await self._reject(scope_type, receive, send)

    @staticmethod
    async def _reject(scope_type: str, receive: Receive, send: Send) -> None:
        if scope_type == "http":
            payload = json.dumps(
                {
                    "detail": "missing or invalid X-Grid-Request-Context envelope",
                    "error": "context_envelope_required",
                }
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [
                        [b"content-type", b"application/json"],
                        [b"content-length", str(len(payload)).encode()],
                    ],
                }
            )
            await send({"type": "http.response.body", "body": payload})
            return

        message = await receive()
        if message.get("type") == "websocket.connect":
            await send({"type": "websocket.close", "code": _WS_POLICY_VIOLATION})
        else:  # pragma: no cover - defensive; ASGI servers always send connect first
            await send({"type": "websocket.close", "code": _WS_POLICY_VIOLATION})
