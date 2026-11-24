from __future__ import annotations

import os

from fastapi import FastAPI
from public_sources.pdf import ENV_FETCHER_URL

from .roles import WebRole
from .startup_banner import deployed_sha

HEALTH_PATH = "/health"


def install_health_route(app: FastAPI, role: WebRole) -> None:
    app.router.routes[:] = [route for route in app.router.routes if getattr(route, "path", None) != HEALTH_PATH]

    @app.get(HEALTH_PATH, tags=["health"], summary="Health check")
    async def health() -> dict[str, str]:
        fetcher = "configured" if os.environ.get(ENV_FETCHER_URL, "").strip() else "missing"
        return {"status": "healthy", "sha": deployed_sha(), "role": role.value, "public_source_fetcher": fetcher}
