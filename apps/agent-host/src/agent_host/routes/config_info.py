import hmac
import logging
import os
from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from agent_host.routes.internal_auth import _TOKEN_HEADERS

logger = logging.getLogger(__name__)


def _token_ok(request: Request) -> bool:
    expected = os.environ.get("INTERNAL_API_TOKEN")
    if not expected:
        return True
    matched = [hmac.compare_digest(request.headers.get(name) or "", expected) for name in _TOKEN_HEADERS]
    return any(matched)


def add_config_info_routes(router: APIRouter, llm_configs: Mapping[str, Any]) -> None:

    defaults = {
        name: getattr(config, "model_name", None) or getattr(config, "model", None)
        for name, config in llm_configs.items()
    }

    base_urls = {name: getattr(config, "base_url", None) for name, config in llm_configs.items()}

    reasoning_efforts = {name: getattr(config, "reasoning_effort", None) for name, config in llm_configs.items()}

    try:
        from knowledge_layer.ingest import resolve_vlm_credential

        vlm_cred = resolve_vlm_credential()
        if vlm_cred.model:
            defaults.setdefault("vlm", vlm_cred.model)
        if vlm_cred.base_url:
            base_urls.setdefault("vlm", vlm_cred.base_url)
    except Exception:  # pragma: no cover - display-only; never block the endpoint
        logger.warning("Could not resolve VLM default model for llm-defaults", exc_info=True)

    @router.get("/v1/config/llm-defaults")
    async def llm_defaults(request: Request) -> dict[str, Any]:
        if not _token_ok(request):
            raise HTTPException(status_code=403, detail="Forbidden")
        return {"llms": defaults, "baseUrls": base_urls, "reasoningEfforts": reasoning_efforts}
