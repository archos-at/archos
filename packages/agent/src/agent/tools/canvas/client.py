from __future__ import annotations

import logging
from typing import Any

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope

logger = logging.getLogger(__name__)

ANNOTATIONS_PATH = "/api/internal/document-annotations"

REQUEST_TIMEOUT_SECONDS = 20
LEAVE_TIMEOUT_SECONDS = 3


class CanvasRequestError(bff_http.BffError):

    def __init__(
        self, message: str, *, status: int | None = None, code: str | None = None, reason: str | None = None
    ) -> None:
        super().__init__(message, status=status, code=code)
        self.reason = reason


def _refusal(exc: bff_http.BffRefusedError) -> CanvasRequestError:
    details = exc.body.get("details") if isinstance(exc.body.get("details"), dict) else {}
    reason = details.get("reason")
    return CanvasRequestError(
        exc.error_text or f"the request was refused ({exc.status})",
        status=exc.status,
        code=exc.code,
        reason=reason if isinstance(reason, str) else None,
    )


def post_canvas(
    payload: dict[str, Any], envelope: SignedEnvelope, *, timeout: float = REQUEST_TIMEOUT_SECONDS
) -> dict[str, Any]:
    try:
        body = bff_http.post_json(ANNOTATIONS_PATH, payload, timeout=timeout, headers=envelope.headers())
    except bff_http.BffNotConfiguredError as exc:
        raise CanvasRequestError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        raise _refusal(exc) from exc
    except bff_http.BffError as exc:
        logger.warning("Canvas request %s failed", payload.get("op"), exc_info=True)
        raise CanvasRequestError("the canvas route could not be reached") from exc
    if not isinstance(body, dict):
        raise CanvasRequestError("the canvas route answered with something that is not an object")
    return body


DOCUMENT_FILE_PATH = "/api/internal/document-file"


def lookup_document_id(collection: str, file_name: str, envelope: SignedEnvelope) -> str | None:
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH,
            timeout=REQUEST_TIMEOUT_SECONDS,
            query={"collection": collection, "filename": file_name},
            headers=envelope.headers(),
        )
    except bff_http.BffNotConfiguredError:
        return None
    except bff_http.BffError:
        logger.info("No document id for %s in %s", file_name, collection, exc_info=True)
        return None
    document_id = body.get("documentId") if isinstance(body, dict) else None
    return document_id if isinstance(document_id, str) and document_id else None
