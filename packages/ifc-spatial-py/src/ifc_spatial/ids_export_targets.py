from __future__ import annotations

from dataclasses import dataclass

NO_THRESHOLD_NOTE = (
    "Diese Prüfung verlangt nur, DASS das Merkmal vorhanden und auswertbar ist. Welcher Wert zulässig ist, "
    "steht in der OIB-Richtlinie und wird hier nicht geprüft."
)

WHY_NO_SPACE_BOUNDARY = (
    "IDS 1.0 kennt dafür kein Facet: die relation-Aufzählung des partOf-Facets umfasst nur IfcRelAggregates, "
    "IfcRelAssignsToGroup, IfcRelContainedInSpatialStructure, IfcRelNests und "
    "IfcRelVoidsElement+IfcRelFillsElement — Raumbegrenzungen sind nicht darunter. Über das entity-Facet ließe "
    "sich IfcRelSpaceBoundary zwar anwendbar machen, aber ein Prüfprogramm darf Beziehungsobjekte übergehen "
    "und meldet die Spezifikation dann als bestanden. Ein stiller Haken auf einen Befund, der offen ist, wäre "
    "schlimmer als dieser Hinweis."
)

WHY_NO_GEOMETRY = (
    "IDS beschreibt, welche Merkmale und Beziehungen ein Modell führen muss, nicht seine Geometrie. Für "
    "Körper, Abstände, lichte Maße und fehlende Volumenkörper gibt es kein Facet."
)

WHY_NOT_ABOUT_THE_MODEL = (
    "Kein Befund über das Modell, sondern über diesen Auswertungslauf. So etwas gehört nicht in eine Datei, "
    "die der Architekt gegen sein Modell laufen lässt — sie würde ihn zu einer Änderung auffordern, die an "
    "seinem Export nichts zu ändern hat."
)

WHY_NO_TRUE_NORTH = (
    "Die Nordrichtung hängt am IfcGeometricRepresentationContext. Das ist kein IfcObjectDefinition, also für "
    "die Anwendbarkeit einer IDS-Spezifikation nicht erreichbar, und TrueNorth ist weder Merkmal noch "
    "Beziehung im Sinne der IDS-Facets."
)

WHY_NO_FACET = (
    "Für diesen Befund ist kein IDS-Facet bekannt: er benennt weder ein Merkmal in einem Property-Set noch "
    "ein Attribut eines Bauteils noch eine der fünf Beziehungen, die IDS 1.0 ausdrücken kann."
)

WHY_NO_ELEMENTS = (
    "Dieses Modell enthält keine Bauteile der Klassen, an denen dieses Merkmal geführt wird — eine "
    "IDS-Spezifikation darauf hätte nichts, worauf sie anwendbar wäre."
)


@dataclass(frozen=True)
class PropertyTarget:
    concept: str
    property: str
    pset: str
    classes: tuple[str, ...]
    standard: bool = True


_WALLS = ("IfcWall", "IfcWallStandardCase")
_DOORS = ("IfcDoor", "IfcDoorStandardCase")
_WINDOWS = ("IfcWindow", "IfcWindowStandardCase")
_SLABS = ("IfcSlab", "IfcSlabStandardCase", "IfcSlabElementedCase")

PROPERTY_TARGETS: tuple[PropertyTarget, ...] = (
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_WallCommon", _WALLS),
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_WallCommon", _WALLS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_CoveringCommon", ("IfcCovering",)),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_WallCommon", _WALLS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_WindowCommon", _WINDOWS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_DoorCommon", _DOORS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_WallCommon", _WALLS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_SlabCommon", _SLABS),
    PropertyTarget("tragend", "LoadBearing", "Pset_WallCommon", _WALLS),
    PropertyTarget("tragend", "LoadBearing", "Pset_SlabCommon", _SLABS),
    PropertyTarget("tragend", "LoadBearing", "Pset_ColumnCommon", ("IfcColumn",)),
    PropertyTarget("tragend", "LoadBearing", "Pset_BeamCommon", ("IfcBeam",)),
    PropertyTarget("außenliegend", "IsExternal", "Pset_WallCommon", _WALLS),
    PropertyTarget("außenliegend", "IsExternal", "Pset_WindowCommon", _WINDOWS),
    PropertyTarget("außenliegend", "IsExternal", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Raumfläche", "NetFloorArea", "Qto_SpaceBaseQuantities", ("IfcSpace",)),
    PropertyTarget("Höhe", "Height", "Qto_SpaceBaseQuantities", ("IfcSpace",)),
    PropertyTarget("Brüstungshöhe", "SillHeight", "Pset_WindowCommon", _WINDOWS, standard=False),
)

_CONVENTION_NOTE = {
    "SillHeight": (
        "Achtung: SillHeight ist in IFC4 kein Merkmal der Vorlage Pset_WindowCommon — dort stehen nur "
        "HasSillExternal und HasSillInternal. Wo ein Exporteur die Brüstungshöhe ablegt, ist nicht genormt; "
        "diese Spezifikation verlangt den Pfad, den dieses Werkzeug liest."
    )
}
