"""Tolerances and vocabulary the operators share: the numbers that decide an answer, each named once."""

from __future__ import annotations


COORDINATE_TOLERANCE = 0.005
DIMENSION_TOLERANCE = 2 * COORDINATE_TOLERANCE
AREA_RELATIVE_TOLERANCE = 0.01
AZIMUTH_TOLERANCE_DEGREES = 3
TESSELLATION_TOLERANCE = 0.005
BOX_TOLERANCE = 0.05
MIN_INTRUSION = 0.005
CONTACT = 0.05
OUTWARD_MIN_DOT = 0.15
OUTWARD_MIN_SPAN = 0.25

COMPASS = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

FENESTRATION = {
    "IfcWindow",
    "IfcWindowStandardCase",
    "IfcDoor",
    "IfcDoorStandardCase",
    "IfcOpeningElement",
}

FURNISHING = ("IfcFurnishingElement", "IfcFurniture", "IfcSystemFurnitureElement")

_RELATIONS = {
    "voids": ("IfcRelVoidsElement", "Öffnungen und Füllungen mitexportieren"),
    "fills": ("IfcRelFillsElement", "Öffnungen und Füllungen mitexportieren"),
    "interfaceOf": (
        "IfcRelSpaceBoundary",
        "Space Boundaries (2nd level) mitexportieren — in Revit/ArchiCAD eine Exporteinstellung",
    ),
    "connects": (
        "IfcRelConnectsElements / IfcRelConnectsPathElements",
        "Bauteilverbindungen mitexportieren — viele Exporte lassen sie weg",
    ),
    "containsElement": (
        "IfcRelContainedInSpatialStructure",
        "Bauteile der Ebene bzw. dem Raum zuordnen und die räumliche Struktur mitexportieren",
    ),
}

_DERIVED_BOUNDARY_CAVEAT = (
    "Aus der Geometrie abgeleitet (geom.tree.select, Berührungstoleranz {contact:.2f} m), nicht in der Datei "
    "deklariert: dieser Export enthält keine IfcRelSpaceBoundary. Die gemessenen Beziehungen tragen eine "
    "Toleranz und können danebenliegen."
)


_HORIZONTAL_SEPARATORS = ("IfcSlab", "IfcRoof", "IfcCovering")


SIDE_TOLERANCE = 0.05
