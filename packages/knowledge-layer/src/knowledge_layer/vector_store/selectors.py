from __future__ import annotations

from typing import Any

from .schema import DOCUMENT_ID_FIELD


def document_chunks(file_name: str, document_id: str | None = None) -> dict[str, Any]:
    named = {"file_name": {"$eq": file_name}}
    if not document_id:
        return named
    return {
        "$or": [
            {DOCUMENT_ID_FIELD: {"$eq": document_id}},
            {"$and": [named, {DOCUMENT_ID_FIELD: {"$exists": False}}]},
        ]
    }
