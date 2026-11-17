from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any


@dataclass
class LookupTrace:
    searched: str = ""
    collection: str = ""
    candidates: list[Any] = field(default_factory=list)
    fetched: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    as_of: str = ""
    as_of_today: str = ""
    versions_dropped: int = 0
    source: str = ""
    source_revision: str = ""
    source_origin: str = ""
