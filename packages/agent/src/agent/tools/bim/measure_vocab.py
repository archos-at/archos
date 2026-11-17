import logging
from collections.abc import Sequence
from typing import Any
from typing import Literal

from agent.tools.bim import measure_register
from agent.tools.bim.failures import rejected_text
from agent.tools.bim.failures import too_large_text
from agent.tools.bim.failures import unrunnable_text

logger = logging.getLogger(__name__)


_rejected_text = rejected_text


_unrunnable_text = unrunnable_text


_too_large_text = too_large_text


OPERATIONS: tuple[str, ...] = (
    "briefing",
    "find_elements",
    "element",
    "relations",
    "measure",
    "survey",
    "element_profile",
    "distance",
    "clearance",
    "sun_position",
    "storey_heights",
    "room_inventory",
    "draw",
    "view",
    "shopping_list",
    "fire",
    "envelope",
    "overhang",
    "light_incidence",
)


VALID_OPERATIONS = frozenset(OPERATIONS)


NON_MEASURING_OPERATIONS: frozenset[str] = frozenset(
    {
        "briefing",
        "find_elements",
        "element",
        "draw",
        "view",
        "shopping_list",
    }
)


RELATIONS: dict[str, str] = {
    "hostedIn": "which wall carries this window/door (from voids+fills)",
    "hosts": "which openings are cut out of this element",
    "fillerOf": "what fills this opening",
    "bounds": "which elements bound this room  [geometry]",
    "enclosedBy": "which rooms this element bounds  [geometry]",
    "opensTo": "which rooms this window/door opens into  [geometry]",
    "connects": "which elements butt onto this one",
    "contains": "which elements sit in this storey or room",
    "containerOf": "which storey or room this element sits in",
    "adjacentSpaces": "which rooms border this room  [geometry]",
    "elementsOfStorey": "every element of this storey, including those in rooms",
    "above": "what is directly ABOVE this element or room  [geometry, rays; furniture excluded]",
    "below": "what is directly BELOW it  [geometry, rays]",
}


GEOMETRIC_RELATIONS = frozenset({"bounds", "enclosedBy", "opensTo", "adjacentSpaces", "above", "below"})


MEASURES: dict[str, str] = {
    "extent": "width, depth, height and centroid of one element",
    "floorArea": (
        "a room's floor area FROM THE GEOMETRY, even when the export publishes none; a published one is "
        "compared and a contradiction reported"
    ),
    "sillAndHead": "Brüstungs- und Sturzhöhe of a window/door above ITS OWN storey",
    "elevation": "underside and top, absolute and above the element's own storey",
    "clearHeight": (
        "lichte Raumhöhe — floor to the LOWEST thing hanging into the room (suspended ceiling, "
        "downstand, duct). NOT the height of the space solid ('extent'), which a Raumhöhennachweis must "
        "not use"
    ),
    "azimuth": "which way a facade faces. Undecidable without TrueNorth in the file",
    "lightEntryArea": (
        "a ROOM's light-entry area and what percent of its floor area that is — the number an OIB 3 "
        "daylight check comes down to. Sums only the EXTERNAL openings (an internal door lights "
        "nothing) and measures the structural clear opening, not the glazed area. Applies no "
        "threshold: the percentage is in the Bestimmung, not in the model"
    ),
    "egressPath": (
        "a ROOM's shortest WALKABLE route to the outside through doors (adjacency is not walkability), "
        "with the rooms, the doors and a length. The length runs through room and door centres, so it "
        "is a LOWER BOUND and not a Fluchtweglänge"
    ),
    "reachableFrom": (
        "every room reachable from this one through doors, with door counts. Answers 'which rooms are "
        "behind this door', and finds rooms with no way out at all — itself a finding"
    ),
    "clearWidth": (
        "the LICHTE Breite and Höhe of an opening, measured on the aperture itself. THIS is what a "
        "door-width or escape-route-width check needs"
    ),
    "orientedExtent": (
        "length/width/height along the ELEMENT's own axes plus its bearing from north. Use for anything "
        "skewed to the model grid, where 'extent' is axis-aligned and systematically too large"
    ),
    "roomDepth": (
        "how deep a room runs back from its daylight facade, the width along that facade, and the ratio "
        "to the clear height. Names which facade it chose and, for a corner room, the runner-up"
    ),
    "stairGeometry": (
        "riser height, tread depth, riser count and the NUTZBREITE of a stair flight, plus the SPREAD "
        "of the risers. Declared values are checked against the geometry and a contradiction reported"
    ),
    "rampSlope": "a ramp's slope as a percentage AND as a ratio, with run, rise and clear width",
    "headroom": ("clear height over a stair flight or ramp, measured PERPENDICULAR to the pitch, not vertically"),
    "stepsOf": "the flights and landings a stair is made of, so one flight can be asked about",
    "turningCircle": (
        "the largest circle that fits on a ROOM's free floor, for a Wendekreis check. Counts fixed built-ins only; "
        "furniture is reported beside it. Applies no threshold"
    ),
    "thresholdHeight": (
        "the step at a door. Where the export models no floor build-up this is a STRUCTURAL number, "
        "which says nothing about the finished threshold, and the answer says so"
    ),
    "balustrade": (
        "where there is a fall at an opening, how far, and what stands there. Undecidable when the "
        "export contains no IfcRailing at all"
    ),
    "clearApproach": "the free floor in front of a door on each side, and what ends it",
}


DISTANCE_MODES = {
    "min": (
        "gap between the two axis-aligned BOUNDING BOXES. 0 means the boxes overlap — it does NOT "
        "prove the solids touch, and on a skewed element the true gap is larger"
    ),
    "centroid": "centre to centre in 3D (Achsabstand). NOT a clear dimension",
    "horizontal": (
        "centre to centre in plan, Z ignored (Achsabstand) — what a plan drawing scales off. NOT a "
        "lichte Breite: for a clear width use measure/clearWidth on the opening"
    ),
    "vertical": (
        "difference in centre HEIGHT — what a section scales off. NOT a lichte Höhe: for that use "
        "measure/clearHeight on the room"
    ),
}


FIRE_ASPECTS = {
    "escape_level": (
        "height of the topmost occupied floor above the lowest adjoining ground — the number the "
        "Gebäudeklasse hangs on. Returns a HEIGHT and never a class"
    ),
    "compartmentArea": "floor area of a fire compartment across several rooms, each room listed",
    "separatingElements": (
        "what lies BETWEEN two rooms — wall, slab, and the doors in them — each with its DECLARED "
        "FireRating, and explicitly with its absence"
    ),
    "siteBoundary": (
        "distance to the site boundary (Brandübertragung). Undecidable on most exports, because a "
        "parcel boundary is rarely exported — and it is not guessed here"
    ),
    "doorGraph": (
        "the WHOLE building's walkable graph: rooms as nodes, OUTSIDE as its own node, doors as edges, "
        "plus the doors that became NEITHER (unbestimmt, ausgeschlossen). A room with no edge has no "
        "way out; an unresolved door is a hole in every route. Takes no global_id"
    ),
}


ENVELOPE_ASPECTS = {
    "thermalEnvelope": (
        "which elements form the boundary between heated inside and outside, grouped by kind, each "
        "with its area, its DECLARED U-value and which rung decided it (declared IsExternal or inferred "
        "from room contact), plus interior (decided, left out) and unbestimmt (neither counted nor "
        "discarded)"
    ),
    "areaByOrientation": (
        "envelope area per compass bearing, opaque and transparent apart, with the window-to-wall "
        "ratio per facade. Needs a declared TrueNorth; without one the bearing is refused, not guessed"
    ),
    "compactness": (
        "A/V in 1/m, with the characteristic length (V over A), and A and V separately. V is the NET "
        "volume (the sum of the IfcSpace solids)"
    ),
}


VIEW_MODES = {
    "highlight": "mark these elements red on the full plan — 'where is this in the building'",
    "only": "draw nothing but these elements — 'what does this look like'",
}


KINDS = ("project", "site", "building", "storey", "space", "element", "opening", "group")


ROOM_KINDS = ("habitable_room", "ancillary_room", "circulation")


MAX_BATCH = 50


PROFILE_KINDS = ("expensive",)


def _enum_lines(entries: dict[str, str], indent: str = "    ") -> str:
    return "\n".join(f"{indent}{name} — {meaning}" for name, meaning in entries.items())


def _literal(*groups) -> Any:
    names = dict.fromkeys(name for group in groups for name in group)
    return Literal[tuple(names)]  # type: ignore[valid-type]


_KIND_FIELD: dict[str, str] = {
    "fire": "fire.kind",
    "envelope": "envelope.kind",
    "element_profile": "element_profile.kind",
}


_ALL_KINDS: tuple[str, ...] = (*KINDS, *FIRE_ASPECTS, *ENVELOPE_ASPECTS, *PROFILE_KINDS)


_CASE_FOLDED: dict[str, tuple[str, ...]] = {
    "operation": OPERATIONS,
    "room_kind": ROOM_KINDS,
    "kind": _ALL_KINDS,
    "mode": (*DISTANCE_MODES, *VIEW_MODES),
}


_LEGACY_TOKENS: dict[str, dict[str, str]] = {
    "room_kind": {"aufenthaltsraum": "habitable_room", "nebenraum": "ancillary_room", "erschliessung": "circulation"},
    "kind": {"fluchtniveau": "escape_level"},
}


def _canonical(asked: str, vocabulary: Sequence[str]) -> str:
    wanted = asked.strip().lower()
    return next((known for known in vocabulary if known.lower() == wanted), asked)


def _record_misses(data: dict[str, Any]) -> None:
    operation = str(data.get("operation") or "").strip().lower()
    checks = (
        ("operation", VALID_OPERATIONS),
        ("measure", MEASURES),
        ("relation", RELATIONS),
        ("room_kind", ROOM_KINDS),
        (_KIND_FIELD.get(operation, "kind"), _ALL_KINDS),
    )
    for name, known in checks:
        asked = data.get(name.split(".")[-1])
        wanted = asked.strip() if isinstance(asked, str) else ""
        if wanted and wanted not in known:
            measure_register.record_gap(surface="ifc_measure", field=name, asked_for=wanted, known=known)
