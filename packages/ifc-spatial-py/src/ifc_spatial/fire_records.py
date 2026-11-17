"""The frozen records a storey judgement and a separating element are read into."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any



@dataclass(frozen=True)
class StoreyJudgement:
    """One storey, its elevation, and whether it was counted — with the reason.

    Both halves travel. A caller that renders only the counted storeys has
    published a number nobody can correct: the whole point of reporting the
    Technikgeschoss that was dropped is that a reviewer who knows it is a
    Wohnung can say so, and the arithmetic is one subtraction away.
    """

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
    """One element between two spaces, with what the file declares about it."""

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
