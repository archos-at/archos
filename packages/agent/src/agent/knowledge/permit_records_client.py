from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.knowledge.permit_extraction import PermitRecord

logger = logging.getLogger(__name__)

_FRONTEND_INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
_INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
_PERMIT_RECORDS_PATH = "/api/internal/permit-records"
_HTTP_TIMEOUT_SECONDS = 30.0


def store_permit_record(
    organization_id: str,
    document_id: str | None,
    collection: str,
    file_name: str,
    model: str,
    record: PermitRecord | None,
) -> bool:
    base_url = os.environ.get(_FRONTEND_INTERNAL_URL_ENV, "").strip()
    token = os.environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not base_url or not token:
        return False
    who = document_id or file_name
    body = {
        "organizationId": organization_id,
        "collection": collection,
        "fileName": file_name,
        "model": model,
        "record": record.to_wire() if record is not None else None,
    }
    if document_id:
        body["documentId"] = document_id
    try:
        from agent.common.connect_retry import connect_retrying_client

        with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{base_url.rstrip('/')}{_PERMIT_RECORDS_PATH}",
                json=body,
                headers={"x-internal-token": token},
            )
        if response.status_code != 200:
            logger.warning(
                "permit_records: the BFF refused the record for document %s (HTTP %d)",
                who,
                response.status_code,
            )
            return False
        if record is None:
            return True
        stored = response.json().get("stored")
    except Exception as e:  # noqa: BLE001 - fail-open: an unreachable BFF must not fail an ingest
        logger.warning("permit_records: could not store the record for document %s (%s)", who, type(e).__name__)
        return False
    if stored is not True:
        logger.warning("permit_records: the BFF did not store the record for document %s", who)
        return False
    return True
