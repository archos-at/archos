"""The tool surface vocabulary: its relations, measures, fire and envelope aspects, and limits."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from . import accessibility as acc
from . import circulation as circ
from . import clearance as clr
from . import daylight as dl

from . import operators as op
from . import relations as extra
from . import stairs as st
from .envelope import Answer
from .model import SpatialModel

RELATIONS: tuple[str, ...] = (
    "hostedIn",
    "hosts",
    "fillerOf",
    "bounds",
    "enclosedBy",
    "opensTo",
    "connects",
    "contains",
    "containerOf",
    "adjacentSpaces",
    "elementsOfStorey",
    "above",
    "below",
)

RELATION_FN: dict[str, Callable[[SpatialModel, str], Answer[Any]]] = {
    "hostedIn": op.hosted_in,
    "hosts": op.hosts,
    "fillerOf": op.filler_of,
    "bounds": op.bounds,
    "enclosedBy": op.enclosed_by,
    "opensTo": op.opens_to,
    "connects": extra.connects,
    "contains": op.contains,
    "containerOf": op.container_of,
    "adjacentSpaces": op.adjacent_spaces,
    "elementsOfStorey": extra.elements_of_storey,
    "above": dl.above,
    "below": dl.below,
}

GEOMETRIC_RELATIONS = frozenset(
    {
        "bounds",
        "enclosedBy",
        "opensTo",
        "adjacentSpaces",
        "above",
        "below",
    }
)

MEASURES: tuple[str, ...] = (
    "extent",
    "floorArea",
    "sillAndHead",
    "elevation",
    "clearHeight",
    "azimuth",
    "lightEntryArea",
    "egressPath",
    "reachableFrom",
    "clearWidth",
    "orientedExtent",
    "roomDepth",
    "stairGeometry",
    "rampSlope",
    "headroom",
    "stepsOf",
    "turningCircle",
    "thresholdHeight",
    "balustrade",
    "clearApproach",
)

MEASURE_FN: dict[str, Callable[[SpatialModel, str], Answer[Any]]] = {
    "extent": op.extent,
    "floorArea": op.floor_area,
    "sillAndHead": op.sill_and_head,
    "elevation": op.elevation,
    "clearHeight": op.clear_height,
    "azimuth": op.azimuth,
    "lightEntryArea": op.light_entry_area,
    "egressPath": circ.egress_path,
    "reachableFrom": circ.reachable_from,
    "clearWidth": clr.clear_opening_width,
    "orientedExtent": clr.oriented_extent,
    "roomDepth": dl.room_depth,
    "stairGeometry": st.stair_geometry,
    "rampSlope": st.ramp_slope,
    "headroom": st.headroom,
    "stepsOf": st.steps_of,
    "turningCircle": acc.turning_circle,
    "thresholdHeight": acc.threshold_height,
    "balustrade": acc.balustrade_check,
    "clearApproach": acc.clear_approach,
}

MEASURE_SUBJECT: dict[str, tuple[str, ...]] = {
    "extent": (),
    "elevation": (),
    "orientedExtent": (),
    "floorArea": (),
    "clearHeight": ("IfcSpace",),
    "lightEntryArea": ("IfcSpace",),
    "egressPath": ("IfcSpace",),
    "reachableFrom": ("IfcSpace",),
    "roomDepth": ("IfcSpace",),
    "turningCircle": ("IfcSpace",),
    "balustrade": ("IfcSpace",),
    "sillAndHead": ("IfcWindow", "IfcDoor"),
    "clearWidth": ("IfcOpeningElement", "IfcDoor", "IfcWindow"),
    "azimuth": ("IfcWall", "IfcWallStandardCase", "IfcCurtainWall", "IfcPlate", "IfcWindow", "IfcDoor"),
    "thresholdHeight": ("IfcDoor",),
    "clearApproach": ("IfcDoor",),
    "stairGeometry": ("IfcStair", "IfcStairFlight"),
    "rampSlope": ("IfcRamp", "IfcRampFlight"),
    "headroom": ("IfcStair", "IfcStairFlight", "IfcRamp", "IfcRampFlight"),
    "stepsOf": ("IfcStair", "IfcStairFlight", "IfcRamp", "IfcRampFlight"),
}

MEASURE_EXPENSIVE: frozenset[str] = frozenset({"egressPath", "reachableFrom", "turningCircle", "clearApproach"})

MEASURE_SLOW_PER_ELEMENT: frozenset[str] = frozenset({"balustrade", "headroom", "roomDepth", "thresholdHeight"})
SLOW_DEFAULT_LIMIT = 12

MEASURE_HEADLINE: dict[str, str] = {
    "clearWidth": "width",
    "turningCircle": "diameter",
    "lightEntryArea": "percent",
    "headroom": "headroom",
    "sillAndHead": "sill",
    "roomDepth": "depth",
    "thresholdHeight": "threshold",
    "azimuth": "degrees",
    "rampSlope": "percent",
    "elevation": "heightAboveStorey",
    "egressPath": "length",
}


_PROFILE_DROPS = ("from", "method", "because")
_PROFILE_LIST_CAP = 3


FIRE_ASPECTS: tuple[str, ...] = (
    "escape_level",
    "compartmentArea",
    "separatingElements",
    "siteBoundary",
    "doorGraph",
)

ENVELOPE_ASPECTS: tuple[str, ...] = (
    "thermalEnvelope",
    "areaByOrientation",
    "compactness",
)

MAX_BATCH = 50

KINDS = ["project", "site", "building", "storey", "space", "element", "opening", "group"]
