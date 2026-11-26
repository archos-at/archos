from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import document_chunks


@dataclass(frozen=True)
class Focus:
    file_name: str
    document_id: str | None = None
    shelf: str | None = None

    def holds(self, chunk: Any) -> bool:
        metadata = getattr(chunk, "metadata", None) or {}
        chunk_document_id = metadata.get(DOCUMENT_ID_FIELD)
        if self.document_id and chunk_document_id:
            return str(chunk_document_id) == self.document_id
        if (getattr(chunk, "file_name", None) or "") != self.file_name:
            return False
        return not self.shelf or metadata.get("shelf") == self.shelf

    def selector(self) -> dict[str, Any]:
        return document_chunks(self.file_name, self.document_id)


def turn_focus() -> Focus | None:
    try:
        from agent.common.focus_file import get_focused_document_id
        from agent.common.focus_file import get_focused_file_name
        from agent.common.focus_file import get_focused_shelf

        file_name = get_focused_file_name()
        if not file_name:
            return None
        return Focus(file_name, get_focused_document_id(), get_focused_shelf())
    except Exception:
        return None
