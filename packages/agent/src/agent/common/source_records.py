from __future__ import annotations

import math
from dataclasses import dataclass

from pydantic import BaseModel
from pydantic import ConfigDict


@dataclass(frozen=True)
class SourceRegion:
    box: tuple[float, float, float, float]
    label: str | None = None

    def to_wire(self) -> dict[str, object]:
        payload: dict[str, object] = {"box": list(self.box)}
        if self.label:
            payload["label"] = self.label
        return payload

    @classmethod
    def from_cached(cls, value: object) -> SourceRegion | None:
        if not isinstance(value, dict):
            return None
        box = value.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            return None
        try:
            x0, y0, x1, y1 = (float(part) for part in box)
        except TypeError, ValueError:
            return None
        if not all(math.isfinite(part) for part in (x0, y0, x1, y1)):
            return None
        label = value.get("label")
        return cls(box=(x0, y0, x1, y1), label=label if isinstance(label, str) and label else None)


class SourceRevision(BaseModel):
    model_config = ConfigDict(frozen=True)

    index: str | None = None
    date: str | None = None
