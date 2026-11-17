"""Tolerances, probe offsets and the verdict sentinel the accessibility checks share."""

from __future__ import annotations


FLOOR_CONTACT = 0.02

MIN_OBSTACLE_AREA = 1e-4

BUFFER_QUAD_SEGS = 16

INSCRIBED_STEPS = 40

OUTSIDE_PROBE = 0.30

PROBE_LIFT = 0.10

RAILING_REACH = 1.0

RAILING_FOOT = 0.5

_VERTICAL_HOSTS = ("IfcWall", "IfcCurtainWall", "IfcColumn", "IfcBeam", "IfcMember")

_VOID_PROBES = ((0.5, 0.5), (0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75))

FREE_FLOOR_MAX_TRIANGLES = 500_000

CONTACT_EXTEND = 0.05

DOORWAY = {"IfcDoor", "IfcDoorStandardCase", "IfcOpeningElement"}

_NOT_A_VERDICT = (
    "Gemessene Geometrie, kein Befund: dieses Modul kennt keinen Grenzwert und wendet keinen an. "
    "Ob das gemessene Maß genügt, entscheidet die Bestimmung."
)
