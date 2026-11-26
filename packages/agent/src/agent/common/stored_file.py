from __future__ import annotations

from typing import Literal

from agent.common import bff_http
from agent.common import seaweed_s3

DOCUMENT_FILE_PATH = "/api/internal/document-file"

AMBIGUOUS_NAME = "ambiguous_name"

Reason = Literal["refused", "unreachable", "missing", "no_store", "too_large", "read_failed", "ambiguous"]


class StoredFileUnavailable(Exception):
    def __init__(self, reason: Reason, *, size: int | None = None) -> None:
        super().__init__(reason)
        self.reason: Reason = reason
        self.size = size


class AmbiguousDocumentName(Exception):
    def __init__(self, file_name: str) -> None:
        super().__init__(file_name)
        self.file_name = file_name


def ambiguous_name_message(file_name: str) -> str:
    return (
        f"Ambiguous: more than one document here is called '{file_name}'; they lie in different folders. Ask the "
        "person which one is meant, then name it by its document id or its folder path (Ordner/Name); never pick one."
    )


def document_file_query(collection: str, file_name: str, document_id: str | None = None) -> dict[str, str]:
    query = {"collection": collection, "filename": file_name}
    if document_id:
        query["documentId"] = document_id
    return query


def names_several_documents(refusal: bff_http.BffRefusedError) -> bool:
    details = refusal.body.get("details")
    reason = details.get("reason") if isinstance(details, dict) else refusal.body.get("reason")
    return refusal.status == 409 and reason == AMBIGUOUS_NAME


def locate_stored_file(
    collection: str, file_name: str, headers: dict[str, str], *, document_id: str | None = None
) -> tuple[str, str]:
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH,
            timeout=10.0,
            query=document_file_query(collection, file_name, document_id),
            headers=headers,
        )
    except bff_http.BffRefusedError as exc:
        raise StoredFileUnavailable("ambiguous" if names_several_documents(exc) else "refused") from exc
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
        size = int(head.get("ContentLength") or 0)
        if size > max_bytes:
            raise StoredFileUnavailable("too_large", size=size)
        data = client.get_object(Bucket=bucket, Key=key)["Body"].read(max_bytes + 1)
    except StoredFileUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - any store fault is one reason for the caller to word
        raise StoredFileUnavailable("read_failed") from exc
    if len(data) > max_bytes:
        raise StoredFileUnavailable("too_large", size=len(data))
    return data
