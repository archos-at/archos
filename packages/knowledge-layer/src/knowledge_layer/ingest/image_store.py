from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any

from agent.common.connect_retry import connect_retrying_client

logger = logging.getLogger(__name__)

_FRONTEND_INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
_INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
_PRESIGN_PATH = "/api/internal/document-image-upload-url"
_HTTP_TIMEOUT_SECONDS = 15.0

Presigner = Callable[[str, str, int, str | None], tuple[str, str] | None]
Uploader = Callable[[str, bytes], None]


def request_upload_slot(
    document_id: str, collection: str, image_index: int, organization_id: str | None = None
) -> tuple[str, str] | None:
    base_url = os.environ.get(_FRONTEND_INTERNAL_URL_ENV, "").strip()
    token = os.environ.get(_INTERNAL_TOKEN_ENV, "").strip()
    if not base_url or not token:
        return None
    try:
        body: dict[str, Any] = {"documentId": document_id, "collection": collection, "imageIndex": image_index}
        if organization_id:
            body["organizationId"] = organization_id
        with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{base_url.rstrip('/')}{_PRESIGN_PATH}",
                json=body,
                headers={"x-internal-token": token},
            )
        if response.status_code != 200:
            logger.info(
                "image_store: no upload slot for image %d of document %s (HTTP %d)",
                image_index,
                document_id,
                response.status_code,
            )
            return None
        data = response.json()
        upload_url = data.get("uploadUrl")
        storage_key = data.get("storageKey")
        if not isinstance(upload_url, str) or not upload_url or not isinstance(storage_key, str) or not storage_key:
            return None
        return upload_url, storage_key
    except Exception as e:  # noqa: BLE001 - fail-open contract
        logger.warning("image_store: presign request failed for document %s: %s", document_id, type(e).__name__)
        return None


def put_raster(upload_url: str, image_bytes: bytes) -> None:
    with connect_retrying_client(read_timeout=_HTTP_TIMEOUT_SECONDS) as client:
        response = client.put(upload_url, content=image_bytes, headers={"Content-Type": "image/jpeg"})
    response.raise_for_status()


def store_extracted_images(
    image_results: list[tuple[dict[str, Any], str, str]],
    *,
    document_id: str,
    collection: str,
    organization_id: str | None = None,
    presign: Presigner | None = None,
    upload: Uploader | None = None,
) -> int:
    presign = presign or request_upload_slot
    upload = upload or put_raster
    ordered = sorted(image_results, key=lambda item: (item[0].get("page_number", 0), item[0].get("image_index", 0)))
    stored = 0
    for index, (record, _content_type, _caption) in enumerate(ordered):
        image_bytes = record.get("image_bytes")
        if not image_bytes:
            continue
        slot = presign(document_id, collection, index, organization_id)
        if slot is None:
            break
        upload_url, storage_key = slot
        try:
            upload(upload_url, image_bytes)
        except Exception as e:  # noqa: BLE001 - fail-open contract
            logger.warning(
                "image_store: upload of image %d for document %s failed (%s); keeping captions only",
                index,
                document_id,
                type(e).__name__,
            )
            break
        record["image_key"] = storage_key
        record["stored_image_index"] = index
        stored += 1
    if stored:
        logger.info("image_store: stored %d/%d raster(s) for document %s", stored, len(ordered), document_id)
    return stored
