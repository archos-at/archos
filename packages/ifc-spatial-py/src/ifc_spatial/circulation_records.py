from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .envelope import ElementRef

OUTSIDE = "AUSSEN"

OUTSIDE_REF = ElementRef(
    global_id=OUTSIDE,
    ifc_type="—",
    name="Freie (außerhalb des Gebäudes)",
    kind="outside",
    via="synthetischer Knoten — außen liegt kein IfcSpace",
)

NON_TRAVERSABLE_DOOR_TYPES = frozenset({"TRAPDOOR"})


@dataclass(frozen=True)
class DoorEdge:
    global_id: str
    name: str | None
    ifc_type: str
    predefined_type: str | None
    a: str
    b: str
    length: float | None
    external: bool
    via: str
    ambiguous: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "globalId": self.global_id,
            "name": self.name,
            "ifcType": self.ifc_type,
            "predefinedType": self.predefined_type,
            "connects": [self.a, self.b],
            "length": self.length,
            "external": self.external,
            "via": self.via,
            "ambiguous": self.ambiguous,
        }


@dataclass(frozen=True)
class DoorGraph:
    nodes: tuple[ElementRef, ...]
    edges: tuple[DoorEdge, ...]
    unresolved: tuple[dict[str, Any], ...]
    excluded: tuple[dict[str, Any], ...]
    build_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": [ref.to_dict() for ref in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "undetermined": list(self.unresolved),
            "excluded": list(self.excluded),
            "buildSeconds": round(self.build_seconds, 3),
        }
