# drop after release 2026-W50

from __future__ import annotations

from starlette.types import ASGIApp
from starlette.types import Receive
from starlette.types import Scope
from starlette.types import Send

SERVICE_HEADERS: frozenset[bytes] = frozenset(
    name.encode("ascii")
    for name in (
        "x-answer-message-id",
        "x-budget",
        "x-collection-scope",
        "x-context-transport",
        "x-disabled-sources",
        "x-feature-memory-reflection",
        "x-internal-token",
        "x-locale",
        "x-model-overrides",
        "x-org-instructions",
        "x-organization-id",
        "x-project-context",
        "x-project-id",
        "x-project-memory",
        "x-request-context",
        "x-request-context-sig",
        "x-user-id",
    )
)


def legacy_name(name: bytes) -> bytes:
    return b"x-grid-" + name.removeprefix(b"x-")


def with_legacy_names(headers: list[tuple[bytes, bytes]]) -> list[tuple[bytes, bytes]]:
    present = {name for name, _ in headers}
    added = [
        (legacy_name(name), value)
        for name, value in headers
        if name in SERVICE_HEADERS and legacy_name(name) not in present
    ]
    return headers + added if added else headers


def with_legacy_header_names(headers: dict[str, str]) -> dict[str, str]:
    copies = {
        legacy_name(name.encode("ascii")).decode("ascii"): value
        for name, value in headers.items()
        if name.encode("ascii") in SERVICE_HEADERS
    }
    return {**copies, **headers}


RENAMED_HEADERS: dict[str, str] = {"x-chat-mode": "x-aiq-mode"}


def legacy_header(name: str) -> str:
    return RENAMED_HEADERS[name]


class LegacyHeaderNamesMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            scope = {**scope, "headers": with_legacy_names(list(scope.get("headers", [])))}
        await self.app(scope, receive, send)
