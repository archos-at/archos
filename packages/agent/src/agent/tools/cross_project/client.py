from __future__ import annotations

import logging
from typing import Any

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope

logger = logging.getLogger(__name__)

SEARCH_PATH = "/api/internal/cross-project/search"
PROJECTS_PATH = "/api/internal/cross-project/projects"
BRIEF_PATH = "/api/internal/cross-project/brief"

REQUEST_TIMEOUT_SECONDS = 30


class CrossProjectLookupError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message, status=status, code=code)


def post_lookup(path: str, payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        body = bff_http.post_json(path, payload, timeout=REQUEST_TIMEOUT_SECONDS, headers=envelope.headers())
    except bff_http.BffNotConfiguredError as exc:
        raise CrossProjectLookupError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        raise CrossProjectLookupError(
            exc.error_text or f"the lookup was refused ({exc.status})", status=exc.status, code=exc.code
        ) from exc
    except bff_http.BffError as exc:
        logger.warning("Cross-project lookup %s failed", path, exc_info=True)
        raise CrossProjectLookupError("the lookup could not be reached") from exc
    if not isinstance(body, dict):
        raise CrossProjectLookupError("the lookup answered with something that is not an object")
    return body
