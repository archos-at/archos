from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any



@dataclass(frozen=True)
class StoreyJudgement:

    global_id: str
    name: str | None
    elevation: float | None
    counted: bool
    why: str
    spaces: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "globalId": self.global_id,
            "name": self.name,
            "elevation": self.elevation,
            "counted": self.counted,
            "why": self.why,
            "rooms": list(self.spaces),
        }




@dataclass(frozen=True)
class SeparatingElement:

    global_id: str
    name: str | None
    ifc_type: str
    role: str
    why: str
    fire_rating: str | None
    compartmentation: bool | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "globalId": self.global_id,
            "name": self.name,
            "ifcType": self.ifc_type,
            "role": self.role,
            "why": self.why,
            "fireRating": self.fire_rating,
            "fireRatingDeklariert": self.fire_rating is not None,
            "compartmentation": self.compartmentation,
        }
