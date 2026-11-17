"""Tolerances and the field names a stair's record may use, each named once."""

from __future__ import annotations

from .operators import FURNISHING


STAIR_TYPES = ("IfcStair", "IfcStairFlight")
RAMP_TYPES = ("IfcRamp", "IfcRampFlight")

TREAD_NORMAL_DOT = 0.99

TREAD_FLATNESS = 0.02

RUNNING_SURFACE_MIN_DOT = 0.05

HEADROOM_REACH = 6.0

HEADROOM_SAMPLE_SPACING = 0.10

HEADROOM_LATERAL = (0.25, 0.5, 0.75)

HEADROOM_TRANSPARENT = FURNISHING

BURIED_OVERLAP_FRACTION = 0.5

BURIED_CLEARANCE = 0.30

FLIGHT_TURN_DEGREES = 30.0

FLIGHT_STRAIGHTNESS = 0.05

LANDING_AREA_FACTOR = 2.0

PLAUSIBLE_RISER = (0.08, 0.40)

BASE_RISER_RELATIVE_SLACK = 0.5

_RISER_COUNT_NAMES = ("NumberOfRiser", "NumberOfRisers", "NumberOfRiserPerFlight")
_RISER_HEIGHT_NAMES = ("RiserHeight",)
_TREAD_LENGTH_NAMES = ("TreadLength", "TreadLengthAtOffset", "Going")
_FLIGHT_WIDTH_NAMES = ("ClearWidth", "Width", "NominalWidth")
_RAMP_SLOPE_NAMES = ("Slope", "RequiredSlope")
