from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DataType = Literal["NUMERIC", "CATEGORICAL", "BOOLEAN"]


@dataclass(frozen=True)
class ScoreDefinition:

    name: str
    data_type: DataType
    description: str
    writer: Literal["agent", "bff", "annotation", "judge"] = "agent"
    categories: tuple[str, ...] = ()
    min_value: float | None = None
    max_value: float | None = None
