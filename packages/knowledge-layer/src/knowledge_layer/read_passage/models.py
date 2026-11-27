from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


class ReadPassageInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document: str
    clause: str | int | None = Field(default=None, validation_alias=AliasChoices("clause", "punkt"))
    page: int | str | None = None
    pages: str | int | None = None
    cursor: str | None = None
    conclusion: str = ""


@dataclass(frozen=True)
class PassageTarget:
    collection: str
    file_name: str
    shelf: str | None
    current: str | None = None
    mail_origin: Mapping[str, Any] | None = field(default=None, compare=False)
    document_id: str | None = None
    folder_path: str = field(default="", compare=False)

    @property
    def selector(self) -> dict[str, Any]:
        from knowledge_layer.vector_store import document_chunks

        return document_chunks(self.file_name, self.document_id)


@dataclass(frozen=True)
class Fetched:
    chunks: list[Any]
    failures: list[BaseException]
    structural: bool
