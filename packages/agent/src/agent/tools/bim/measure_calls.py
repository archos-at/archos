from collections.abc import Sequence
from typing import Any

from agent.tools.bim.measure_vocab import _ALL_KINDS
from agent.tools.bim.measure_vocab import DISTANCE_MODES
from agent.tools.bim.measure_vocab import MEASURES
from agent.tools.bim.measure_vocab import RELATIONS
from agent.tools.bim.measure_vocab import ROOM_KINDS
from agent.tools.bim.measure_vocab import VIEW_MODES

_EngineCall = tuple[str, dict[str, Any]]


_SUBJECT_OPERATIONS = frozenset({"element", "relations", "measure", "element_profile", "clearance", "distance"})


_VOCABULARIES: dict[str, Sequence[str]] = {
    "relation": tuple(RELATIONS),
    "measure": tuple(MEASURES),
    "mode": (*DISTANCE_MODES, *VIEW_MODES),
    "kind": _ALL_KINDS,
    "room_kind": ROOM_KINDS,
}


_KIND_ADVICE = "'kind' is the spatial ROLE (a room is 'space'); an IFC type goes in 'ifc_type'."


_MODE_ADVICE = (
    "All four are AXIS distances between centroids or boxes — none is a clear dimension. "
    "For a lichte Breite use operation='measure' with measure='clearWidth' on the opening, and "
    "for a lichte Höhe measure='clearHeight' on the room."
)


_ADVICE = {"kind": _KIND_ADVICE, "mode": _MODE_ADVICE}


def _does_not_exist(field: str, asked: Any, vocabulary: Sequence[str]) -> str:
    advice = _ADVICE.get(field)
    return f"Error: {field} '{asked}' does not exist. Use one of: {', '.join(vocabulary)}." + (
        f" {advice}" if advice else ""
    )


def _needs(operation: str, field: str, vocabulary: Sequence[str]) -> str:
    return f"Error: operation '{operation}' needs '{field}'. Use one of: {', '.join(vocabulary)}."


def _ids(text: str) -> list[str]:
    return [part.strip() for part in text.split(",") if part.strip()]
