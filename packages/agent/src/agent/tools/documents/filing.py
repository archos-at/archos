from __future__ import annotations

import logging
import urllib.parse
from typing import Any

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope

logger = logging.getLogger(__name__)

INTERNAL_DOCUMENT_VERSIONS_PATH = "/api/internal/document-versions"

INTERNAL_DOCUMENT_VERSION_CONTENT_PATH = "/api/internal/document-versions/{version_id}/content"

CONTENT_TIMEOUT_SECONDS = 5

REQUEST_TIMEOUT_SECONDS = 15


class FilingError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message, status=status, code=code)


def get_document_version_content(
    version_id: str,
    organization_id: str,
    conversation_id: str,
    user_id: str | None = None,
    answer_message_id: str | None = None,
) -> dict[str, Any]:
    path = INTERNAL_DOCUMENT_VERSION_CONTENT_PATH.format(version_id=urllib.parse.quote(version_id, safe=""))
    params = {"organizationId": organization_id, "conversationId": conversation_id}
    if user_id:
        params["userId"] = user_id
    if answer_message_id:
        params["answerMessageId"] = answer_message_id

    try:
        body = bff_http.get_json(path, timeout=CONTENT_TIMEOUT_SECONDS, query=params)
    except bff_http.BffNotConfiguredError as exc:
        raise FilingError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("Version content refused by the BFF (status=%s code=%s)", exc.status, exc.code)
        raise FilingError(
            f"the document API refused the read ({exc.status})", status=exc.status, code=exc.code
        ) from exc
    except bff_http.BffError as exc:
        logger.warning("Version content could not be read from the BFF", exc_info=True)
        raise FilingError("the document API could not be reached") from exc

    if not isinstance(body, dict):
        raise FilingError("the document API answered with something that is not an object")
    return body


def post_document_version(payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        body = bff_http.post_json(
            INTERNAL_DOCUMENT_VERSIONS_PATH, payload, timeout=REQUEST_TIMEOUT_SECONDS, headers=envelope.headers()
        )
    except bff_http.BffNotConfiguredError as exc:
        raise FilingError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("Filing refused by the BFF (status=%s code=%s)", exc.status, exc.code)
        raise FilingError(
            f"the document API refused the call ({exc.status})", status=exc.status, code=exc.code
        ) from exc
    except bff_http.BffError as exc:
        logger.warning("Filing could not reach the BFF", exc_info=True)
        raise FilingError("the document API could not be reached") from exc

    if not isinstance(body, dict):
        raise FilingError("the document API answered with something that is not an object")
    return body
