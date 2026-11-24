from __future__ import annotations

import re
import threading
import time

from opentelemetry import metrics
from starlette.types import ASGIApp
from starlette.types import Receive
from starlette.types import Scope
from starlette.types import Send

IN_FLIGHT = "grid.http.requests_in_flight"
REQUEST_SECONDS = "grid.http.request_seconds"

KIND_REQUEST = "request"
KIND_STREAM = "stream"

_STREAM_PATH = re.compile(r"^/v1/jobs/async/job/[^/]+/stream(?:/[^/]+)?$")

_SKIPPED_EXACT = frozenset({"/health", "/openapi.json"})
_SKIPPED_PREFIXES = ("/docs", "/redoc")

_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60)


class _Instruments:
    def __init__(self, meter: metrics.Meter) -> None:
        self.in_flight = meter.create_up_down_counter(
            IN_FLIGHT, description="HTTP requests in flight, by role and kind (stream or request)"
        )
        self.request_seconds = meter.create_histogram(
            REQUEST_SECONDS,
            unit="s",
            description="Seconds an HTTP request took to finish (kind=request only)",
            explicit_bucket_boundaries_advisory=_BUCKETS,
        )


_instruments: _Instruments | None = None
_instruments_lock = threading.Lock()


def instruments() -> _Instruments:
    global _instruments
    with _instruments_lock:
        if _instruments is None:
            _instruments = _Instruments(metrics.get_meter("agent_host.inflight"))
        return _instruments


def kind_for_path(path: str) -> str | None:
    if path in _SKIPPED_EXACT or path.startswith(_SKIPPED_PREFIXES):
        return None
    return KIND_STREAM if _STREAM_PATH.match(path) else KIND_REQUEST


class InFlightMiddleware:
    def __init__(self, app: ASGIApp, *, role: str) -> None:
        self.app = app
        self._role = role

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = kind_for_path(scope.get("path", "")) if scope.get("type") == "http" else None
        if kind is None:
            await self.app(scope, receive, send)
            return

        meters = instruments()
        attributes = {"role": self._role, "kind": kind}
        started = time.monotonic()
        meters.in_flight.add(1, attributes)
        try:
            await self.app(scope, receive, send)
        finally:
            meters.in_flight.add(-1, attributes)
            if kind == KIND_REQUEST:
                meters.request_seconds.record(time.monotonic() - started, attributes)
