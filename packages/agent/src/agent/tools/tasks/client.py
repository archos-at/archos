from __future__ import annotations

import logging
from typing import Any

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope

logger = logging.getLogger(__name__)

INTERNAL_TASKS_PATH = "/api/internal/tasks"

REQUEST_TIMEOUT_SECONDS = 20


class DelegationError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message, status=status, code=code)


def _refusal_message(exc: bff_http.BffRefusedError) -> str:
    base = f"the task API refused the call ({exc.status})"
    return f"{base}: {exc.error_text}" if exc.error_text else base


def post_task(payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        body = bff_http.post_json(
            INTERNAL_TASKS_PATH, payload, timeout=REQUEST_TIMEOUT_SECONDS, headers=envelope.headers()
        )
    except bff_http.BffNotConfiguredError as exc:
        raise DelegationError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("Delegation refused by the BFF (status=%s code=%s)", exc.status, exc.code)
        raise DelegationError(_refusal_message(exc), status=exc.status, code=exc.code) from exc
    except bff_http.BffError as exc:
        logger.warning("Delegation could not reach the BFF", exc_info=True)
        raise DelegationError("the task API could not be reached") from exc

    if not isinstance(body, dict):
        raise DelegationError("the task API answered with something that is not an object")
    return body
