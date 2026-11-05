"""The tool surface vocabulary: its relations, measures, fire and envelope aspects, and limits."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from . import accessibility as acc
from . import circulation as circ
from . import clearance as clr
from . import daylight as dl

# `env`, not `envelope`: `envelope.py` is the ANSWER CONTRACT (`Answer`,
# `computed`, `undecidable`) and `envelope_geometry.py` is the thermal envelope.
# Two unrelated meanings of one word, one of which is imported from below.
from . import operators as op
from . import relations as extra
from . import stairs as st
from .envelope import Answer
from .model import SpatialModel

#: The relation names ``relations`` accepts. What each one answers is written once, in the agent's
#: ``measure_vocab.py`` (the tool the model reads), and pinned against these names.
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

#: The relations that fall back to the geometric contact map when the export
#: declares no ``IfcRelSpaceBoundary`` — which is the common case.
#:
#: Named as a set rather than left implicit because two things depend on it: the
#: warning in the ``relations`` description, and ``element``'s refusal to probe
#: them just to list what is available. A six-second contact map is a reasonable
#: price for an answer somebody asked for and an unreasonable one for a menu.
GEOMETRIC_RELATIONS = frozenset(
    {
        "bounds",
        "enclosedBy",
        "opensTo",
        "adjacentSpaces",
        # `above`/`below` cast rays, so they need the OCCT tree. Left out of this
        # set they were probed by `element` to build its "available relations"
        # menu — which ran the geometry pass on a model whose caller had only
        # asked what an element is called. That is the one rule this file has.
        "above",
        "below",
    }
)

#: The measurements ``measure`` exposes (their meaning: the agent's ``measure_vocab.py``).
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

#: Which IFC types each measure is ABOUT, read off the operators' own
#: signatures — `clear_height(model, space_global_id)` takes a space, and
#: `threshold_height(model, door_global_id)` takes a door.
#:
#: An empty tuple means the measure is about geometry as such and applies to
#: anything with a shape (`extent`, `elevation`, `orientedExtent`, `floorArea`).
#:
#: This is deliberately NOT wired into `measure` as a refusal. Asking for the
#: floor area of a wall is odd but answerable, and a guard here would turn a
#: type this table happens not to list — IfcSpatialZone, a proxy standing in for
#: a room — into a refusal for a measurement that would have worked. The table
#: exists to CHOOSE, in `profile`, not to forbid.
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

#: Measures that walk the door graph or sample a raster over the whole model.
#: `profile` runs them only when asked, because a profile is meant to be the
#: cheap „was ist das für ein Bauteil" call and these are seconds, not
#: milliseconds — the same budget argument that motivates `survey`.
MEASURE_EXPENSIVE: frozenset[str] = frozenset({"egressPath", "reachableFrom", "turningCircle", "clearApproach"})

#: A DIFFERENT expensive, and the distinction is the point.
#:
#: `MEASURE_EXPENSIVE` names measures with a large fixed setup — the door graph,
#: a raster over the model — which a profile pays once and a survey amortises
#: over the whole set. These are the opposite: cheap to start and costly PER
#: ELEMENT, so a survey multiplies them. Measured on AC20-Institute-Var-2:
#: `balustrade` over 50 rooms is 53 s and `headroom` over FOUR stairs is 50 s,
#: while `egressPath` — nominally the expensive one — is 0.03 s over 50 rooms.
#:
#: A tool call that takes a minute is a broken tool at a budget of five turns,
#: so the default set is smaller for these and the narrowing is stated. A caller
#: who wants all fifty says so with an explicit `limit`.
MEASURE_SLOW_PER_ELEMENT: frozenset[str] = frozenset({"balustrade", "headroom", "roomDepth", "thresholdHeight"})
SLOW_DEFAULT_LIMIT = 12

#: The one number a caller means when a measure returns a dict.
#:
#: Most measures answer with a structure — `clearWidth` returns width, height,
#: area and rectangularity — and a survey over fifty of them could report no
#: spread at all, because there was no single number to disperse. Eighteen of
#: the twenty measures were in that state: the tool sold „die Spanne ist der
#: Befund" and produced a Spanne for `floorArea` and `clearHeight` only.
#:
#: The key is NAMED in the output (`summary.spreadOf`) rather than assumed, so
#: „Spanne 0.13" cannot be read as being about the height when it is about the
#: width.
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


#: Audit fields a profile drops. Not because they do not matter — they are the
#: reason this package exists — but because a profile is the ORIENTATION call,
#: and `from`/`method` for sixteen measures at once is several thousand tokens
#: of provenance for numbers the caller has not yet decided to care about. One
#: `measure` call brings the full answer back for the one that mattered.
_PROFILE_DROPS = ("from", "method", "because")
_PROFILE_LIST_CAP = 3


#: The `what` values `fire` accepts.
FIRE_ASPECTS: tuple[str, ...] = (
    "escape_level",
    "compartmentArea",
    "separatingElements",
    "siteBoundary",
    "doorGraph",
)

#: The `what` values `envelope` accepts.
#:
#: Grouped for the same reason as `FIRE_ASPECTS`: one subject — the building as
#: a heat-loss problem — asked three ways. All three take the WHOLE model and no
#: GlobalId, which is what separates them from `measure`: an envelope is not a
#: property of an element, it is the set of elements that happens to bound the
#: heated volume, and asking about it one wall at a time is how the wall that
#: was left out stays invisible.
ENVELOPE_ASPECTS: tuple[str, ...] = (
    "thermalEnvelope",
    "areaByOrientation",
    "compactness",
)

#: How many elements one `measure` call may take.
#:
#: The cap exists because the geometry is real work — a `clearHeight` is a
#: 25-ray raster per room — and an agent that pastes a whole building into
#: the field would sit inside one tool call for minutes with no way to see
#: progress. Fifty covers every storey in the corpus (the largest is 22
#: rooms) and refuses the paste.
MAX_BATCH = 50

KINDS = ["project", "site", "building", "storey", "space", "element", "opening", "group"]
