from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from typing import Literal

from agent.common.action_rows import ActionRow

SettledStatus = Literal["ok", "empty", "error"]


@dataclass
class ActionOutcome:
    hits: int | None = None
    documents: int | None = None
    searched: int | None = None
    files: int | None = None
    folders: int | None = None
    failed: bool = False
    completed: bool = False
    target: str | None = None
    unnamed: bool = False
    incomplete: bool = False

    def record_chunks(self, chunks: Iterable[Any]) -> None:
        listed = list(chunks)
        documents = len({(getattr(c, "file_name", None) or "", _collection(c)) for c in listed})
        self.record(len(listed), documents=documents, collections=[_collection(c) for c in listed])

    def record(self, hits: int, *, documents: int | None = None, collections: Iterable[str | None] = ()) -> None:
        from agent.knowledge.restricted_use import may_name

        if all(may_name(collection) for collection in collections):
            self.hits, self.documents = hits, documents
            return
        self.hits = self.documents = None
        self.unnamed = True

    def status(self, *, default: SettledStatus = "ok") -> SettledStatus:
        if self.failed:
            return "error"
        counted = [n for n in (self.hits, self.files, self.folders) if n is not None]
        if not counted:
            return "ok" if self.unnamed else default
        return "empty" if not any(counted) else "ok"

    def settle(self, row: ActionRow, *, default: SettledStatus = "ok", **fields: Any) -> None:
        counts = {
            "hits": self.hits,
            "documents": self.documents,
            "searched": self.searched,
            "files": self.files,
            "folders": self.folders,
        }
        if self.incomplete:
            fields = {**fields, "incomplete": True}
        row.finish(self.status(default=default), counts=counts, **fields)


def _collection(chunk: Any) -> str:
    metadata = getattr(chunk, "metadata", None) or {}
    return str(metadata.get("collection") or "")
