from __future__ import annotations

import logging
import os

from agent.common.connect_retry import connect_retrying_client

logger = logging.getLogger(__name__)

_FRONTEND_INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
_INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
_EXISTS_PATH = "/api/internal/document-exists"
_HTTP_TIMEOUT_SECONDS = 10.0


def document_still_exists(document_id: str, collection: str, organization_id: str | None = None) -> bool | None:
    base_url = os.environ.get(_FRONTEND_INTERNAL_URL_ENV, "").strip()
    token = os.environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not base_url or not token:
        return None
    params = {"documentId": document_id, "collection": collection}
    if organization_id:
        params["organizationId"] = organization_id
    try:
        with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
            response = client.get(
                f"{base_url.rstrip('/')}{_EXISTS_PATH}",
                params=params,
                headers={"x-internal-token": token},
            )
        if response.status_code != 200:
            logger.warning(
                "document_presence: no answer for document %s (HTTP %d); treating it as present",
                document_id,
                response.status_code,
            )
            return None
        exists = response.json().get("exists")
    except Exception as e:  # noqa: BLE001 - fail-open: an unreachable BFF must not cost a document its chunks
        logger.warning(
            "document_presence: could not ask about document %s (%s); treating it as present",
            document_id,
            type(e).__name__,
        )
        return None
    if not isinstance(exists, bool):
        logger.warning("document_presence: unreadable answer for document %s; treating it as present", document_id)
        return None
    return exists
