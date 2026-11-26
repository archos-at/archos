from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from . import name_scope
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


def named_chunks(file_names: Iterable[str]) -> dict[str, Any]:
    named = {"file_name": {"$in": sorted(set(file_names))}}
    if not name_scope.NAMES_SKIP_IDENTIFIED_POINTS:
        return named
    return {"$and": [named, {DOCUMENT_ID_FIELD: {"$exists": False}}]}
