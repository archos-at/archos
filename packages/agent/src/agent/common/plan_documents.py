from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

MAX_PLAN_DOCUMENTS = 20
MAX_DOCUMENT_NAME_CHARS = 256
MAX_DOCUMENT_TITLE_CHARS = 256
MAX_SHELF_CHARS = 64


LEGACY_PLAN_DOCUMENT_KEYS = {"grundlage": "basis", "ausgeschlossen": "excluded"}
_LEGACY_KEYS = {new: old for old, new in LEGACY_PLAN_DOCUMENT_KEYS.items()}


class PlanDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_DOCUMENT_NAME_CHARS)
    title: str | None = Field(default=None, max_length=MAX_DOCUMENT_TITLE_CHARS)
    shelf: str | None = Field(default=None, max_length=MAX_SHELF_CHARS)

    @property
    def label(self) -> str:
        return self.title or self.name


class PlanDocuments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    basis: list[PlanDocument] = Field(default_factory=list, max_length=MAX_PLAN_DOCUMENTS)
    excluded: list[PlanDocument] = Field(default_factory=list, max_length=MAX_PLAN_DOCUMENTS)

    @model_validator(mode="before")
    @classmethod
    def _legacy_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        for old, new in LEGACY_PLAN_DOCUMENT_KEYS.items():
            if old in out:
                out.setdefault(new, out.pop(old))
        return out

    def is_empty(self) -> bool:
        return not self.basis and not self.excluded

    def excluded_names(self) -> set[str]:
        return {_fold(doc.name) for doc in self.excluded}


def _fold(name: str) -> str:
    return name.strip().casefold()


def _clip(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()[:limit]
    return text or None


def sanitize_plan_documents(raw: Any) -> PlanDocuments | None:
    if not isinstance(raw, dict):
        return None
    out = PlanDocuments()
    seen: set[str] = set()
    for key in ("excluded", "basis"):
        rows = raw.get(key)
        if rows is None:
            rows = raw.get(_LEGACY_KEYS[key])
        if not isinstance(rows, list):
            continue
        target = out.excluded if key == "excluded" else out.basis
        for row in rows:
            doc = _document_from(row)
            if doc is None or _fold(doc.name) in seen or len(target) >= MAX_PLAN_DOCUMENTS:
                continue
            seen.add(_fold(doc.name))
            target.append(doc)
    return None if out.is_empty() else out


def _document_from(row: Any) -> PlanDocument | None:
    if isinstance(row, str):
        name = _clip(row, MAX_DOCUMENT_NAME_CHARS)
        return PlanDocument(name=name) if name else None
    if not isinstance(row, dict):
        return None
    name = _clip(row.get("name") or row.get("file_name"), MAX_DOCUMENT_NAME_CHARS)
    if not name:
        return None
    return PlanDocument(
        name=name,
        title=_clip(row.get("title") or row.get("display_title"), MAX_DOCUMENT_TITLE_CHARS),
        shelf=_clip(row.get("shelf"), MAX_SHELF_CHARS),
    )


def resolve_documents(names: list[Any], inventory: list[dict[str, Any]] | None) -> list[PlanDocument]:
    rows = inventory or []
    by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in (row.get("file_name"), row.get("display_title")):
            if isinstance(key, str) and key.strip():
                by_key.setdefault(_fold(key), row)
    out: list[PlanDocument] = []
    seen: set[str] = set()
    for name in names:
        if not isinstance(name, str) or not name.strip():
            continue
        row = by_key.get(_fold(name))
        if row is None:
            continue
        file_name = str(row.get("file_name") or "").strip()
        if not file_name or _fold(file_name) in seen or len(out) >= MAX_PLAN_DOCUMENTS:
            continue
        seen.add(_fold(file_name))
        out.append(
            PlanDocument(
                name=file_name[:MAX_DOCUMENT_NAME_CHARS],
                title=_clip(row.get("display_title"), MAX_DOCUMENT_TITLE_CHARS),
                shelf=_clip(row.get("shelf"), MAX_SHELF_CHARS),
            )
        )
    return out


def documents_from_plan(
    basis: list[str], excluded: list[str], inventory: list[dict[str, Any]] | None
) -> PlanDocuments | None:
    resolved_excluded = resolve_documents(excluded, inventory)
    excluded_keys = {_fold(doc.name) for doc in resolved_excluded}
    read = [doc for doc in resolve_documents(basis, inventory) if _fold(doc.name) not in excluded_keys]
    docs = PlanDocuments(basis=read, excluded=resolved_excluded)
    return None if docs.is_empty() else docs


def unread_basis(
    documents: PlanDocuments | None, read_names: set[str], added: Sequence[PlanDocument] = ()
) -> list[PlanDocument]:
    basis = [*(documents.basis if documents is not None else ()), *added]
    seen = {_fold(name) for name in read_names}
    unread: list[PlanDocument] = []
    for doc in basis:
        key = _fold(doc.name)
        if key in seen:
            continue
        seen.add(key)
        unread.append(doc)
    return unread
