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


@dataclass(frozen=True)
class Fetched:
    chunks: list[Any]
    failures: list[BaseException]
    structural: bool
