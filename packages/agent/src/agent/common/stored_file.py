from __future__ import annotations

from typing import Literal

from agent.common import bff_http
from agent.common import seaweed_s3

DOCUMENT_FILE_PATH = "/api/internal/document-file"

Reason = Literal["refused", "unreachable", "missing", "no_store", "too_large", "read_failed"]


class StoredFileUnavailable(Exception):
    def __init__(self, reason: Reason) -> None:
        super().__init__(reason)
        self.reason: Reason = reason


def locate_stored_file(collection: str, file_name: str, headers: dict[str, str]) -> tuple[str, str]:
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH, timeout=10.0, query={"collection": collection, "filename": file_name}, headers=headers
        )
    except bff_http.BffRefusedError as exc:
        raise StoredFileUnavailable("refused") from exc
    except bff_http.BffError as exc:
        raise StoredFileUnavailable("unreachable") from exc
    key = body.get("storageKey") if isinstance(body, dict) else None
    if not isinstance(key, str) or not key:
        raise StoredFileUnavailable("missing")
    bucket = body.get("storageBucket")
    return (bucket if isinstance(bucket, str) and bucket else seaweed_s3.default_bucket()), key


def read_stored_file(bucket: str, key: str, max_bytes: int) -> bytes:
    client = seaweed_s3.s3_client()
    if client is None:
        raise StoredFileUnavailable("no_store")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
        if int(head.get("ContentLength") or 0) > max_bytes:
            raise StoredFileUnavailable("too_large")
        data = client.get_object(Bucket=bucket, Key=key)["Body"].read(max_bytes + 1)
    except StoredFileUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - any store fault is one reason for the caller to word
        raise StoredFileUnavailable("read_failed") from exc
    if len(data) > max_bytes:
        raise StoredFileUnavailable("too_large")
    return data
