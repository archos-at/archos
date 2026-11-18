from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Literal

ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT"
SERVICE_NAME_ENV = "OTEL_SERVICE_NAME"
DEFAULT_SERVICE_NAME = "backend-chat"

Signal = Literal["traces", "logs", "metrics"]
_SIGNALS: tuple[Signal, ...] = ("traces", "logs", "metrics")


def signal_endpoint(endpoint: str, signal: Signal) -> str:
    base = endpoint.strip().rstrip("/")
    for known in _SIGNALS:
        suffix = f"/v1/{known}"
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return f"{base}/v1/{signal}"


def resource_attributes(env: Mapping[str, str], pid: int | None = None) -> dict[str, str | int]:
    attributes: dict[str, str | int] = {
        "service.name": env.get(SERVICE_NAME_ENV, "").strip() or DEFAULT_SERVICE_NAME,
        "process.pid": os.getpid() if pid is None else pid,
    }
    sha = env.get("GIT_SHA", "").strip()
    if sha:
        attributes["service.version"] = sha
    instance = env.get("HOSTNAME", "").strip()
    if instance:
        attributes["service.instance.id"] = instance
    return attributes
