from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from agent.knowledge.document_classification import qdrant_doc_class

FOLDER_FIELD = "folder_ancestors"


def folder_key(path: Any) -> str | None:
    key = str(path or "").strip().strip("/").casefold()
    return key or None


def folder_ancestors(path: Any) -> list[str]:
    key = folder_key(path)
    if key is None:
        return []
    parts = [part for part in key.split("/") if part]
    return ["/".join(parts[: depth + 1]) for depth in range(len(parts))]


@dataclass(frozen=True)
class Pushdown:

    doc_class: str | None = None
    folder: str | None = None
    hide_superseded: bool = True
    document_type: str | None = None
    references: tuple[str, ...] = ()

    def clauses(self, *, user_shelf: bool) -> list[dict[str, Any]]:
        clauses: list[dict[str, Any]] = []
        if self.doc_class:
            clauses.append({"doc_class": qdrant_doc_class(self.doc_class)})
        if self.folder:
            clauses.append({FOLDER_FIELD: self.folder})
        if self.hide_superseded and user_shelf:
            clauses.append({"superseded": {"$ne": True}})
        if self.document_type:
            clauses.append({"document_type": self.document_type})
        if self.references:
            clauses.append({"references": {"$in": list(self.references)}})
        return clauses

    def narrow(self, filters: dict[str, Any] | None, *, user_shelf: bool) -> dict[str, Any] | None:
        clauses = self.clauses(user_shelf=user_shelf)
        if not clauses:
            return filters
        parts = [filters, *clauses] if filters else clauses
        return parts[0] if len(parts) == 1 else {"$and": parts}

    def fields(self, *, user_shelves: bool) -> list[str]:
        return [
            field
            for field, used in (
                ("doc_class", bool(self.doc_class)),
                (FOLDER_FIELD, bool(self.folder)),
                ("superseded", self.hide_superseded and user_shelves),
                ("document_type", bool(self.document_type)),
                ("references", bool(self.references)),
            )
            if used
        ]


def plan(
    *,
    doc_class: str | None,
    folder: str | None,
    file_name: str | None,
    document_type: str | None = None,
    refers_to: str | None = None,
) -> Pushdown:
    from knowledge_layer.references import reference_keys_for
    from knowledge_layer.references import spellings

    from .payload import reference_value

    references = tuple(
        dict.fromkeys(
            reference_value(kind, spelling)
            for kind, key in reference_keys_for(refers_to or "")
            for spelling in spellings(kind, key)
        )
    )
    return Pushdown(
        doc_class=doc_class or None,
        folder=folder_key(folder),
        hide_superseded=not file_name,
        document_type=(document_type or "").strip() or None,
        references=references,
    )


def post_filtered(*, title_contains: str | None, file_name: str | None) -> bool:
    return bool(title_contains or file_name)


def without_files(chunks: Sequence[Any], file_names: Iterable[str]) -> list[Any]:
    hidden = set(file_names)
    return [chunk for chunk in chunks if getattr(chunk, "file_name", None) not in hidden]
