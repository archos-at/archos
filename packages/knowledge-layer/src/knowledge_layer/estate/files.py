from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.estate_paths import SHELF_MOUNTS
from agent.common.estate_paths import TEXT_EXTENSIONS
from agent.common.estate_paths import Mount
from agent.common.estate_paths import estate_path
from knowledge_layer import stored_pages
from knowledge_layer.browse import FileRow

from .constants import IMAGE_EXTENSIONS
from .constants import MAX_SUGGESTIONS
from .constants import MODEL_EXTENSIONS


@dataclass(frozen=True)
class EstateFile:
    row: FileRow
    mount: Mount
    path: str
    restricted: bool = False

    @property
    def leaf(self) -> str:
        return self.path.rsplit("/", 1)[-1]

    @property
    def paged(self) -> bool:
        name = self.row.file_name.lower()
        return not name.endswith((*TEXT_EXTENSIONS, *IMAGE_EXTENSIONS, *MODEL_EXTENSIONS))


def estate_file(row: FileRow, *, restricted: bool = False) -> EstateFile | None:
    shelf = row.shelf or ""
    mount = SHELF_MOUNTS.get(shelf)
    path = estate_path(shelf, row.folder, row.file_name)
    if mount is None or path is None:
        return None
    return EstateFile(row=row, mount=mount, path=path, restricted=restricted)


@dataclass
class Resolution:
    file: EstateFile | None
    note: str = ""
    suggestions: list[str] = field(default_factory=list)


@dataclass
class ToolOutput:
    text: str
    hits: tuple[Any, ...] = ()
    status: str = "ok"


def no_such_file(path: str, suggestions: Sequence[str] = ()) -> str:
    text = f'No file "{path}".'
    if suggestions:
        text += " Did you mean:\n" + "\n".join(f"- {name}" for name in suggestions[:MAX_SUGGESTIONS])
    return (
        text + "\n`ls` a folder or `glob` by name to see what exists; `grep` finds wording, `knowledge_search` meaning."
    )


def _content_type(page: stored_pages.Page) -> str:
    if page.is_drawing:
        return "drawing"
    for kind in ("table", "image", "chart"):
        if page.content_types and set(page.content_types) == {kind}:
            return kind
    return "text"
