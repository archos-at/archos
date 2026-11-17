from __future__ import annotations

from typing import Literal

MAX_TYPES = 15
MAX_DIALECT = 10
MAX_STOREYS = 12
MAX_BLIND_SPOTS = 8
DIALECT_SAMPLE_SIZE = 4000

DECISIVE_PROPERTIES: tuple[tuple[str, str], ...] = (
    ("Feuerwiderstand", "FireRating"),
    ("Brennbarkeit", "Combustible"),
    ("U-Wert", "ThermalTransmittance"),
    ("Schallschutz", "AcousticRating"),
    ("tragend", "LoadBearing"),
    ("außenliegend", "IsExternal"),
    ("Raumfläche", "NetFloorArea"),
    ("Höhe", "Height"),
    ("Brüstungshöhe", "SillHeight"),
)



RoomUseKind = Literal["habitable_room", "ancillary_room", "circulation"]


LEGACY_ROOM_USE_KINDS: dict[str, str] = {
    "aufenthaltsraum": "habitable_room",
    "nebenraum": "ancillary_room",
    "erschliessung": "circulation",
}

KIND_LABEL: dict[str, str] = {
    "habitable_room": "Aufenthaltsraum",
    "ancillary_room": "Nebenraum",
    "circulation": "Erschließungsfläche",
}

_FREIBEREICH = "Freibereich — kein Aufenthaltsraum, aber auch kein Nebenraum im engeren Sinn"

MATCH_CONFIDENCE = {"exact": 0.9, "word": 0.8, "part": 0.65}

MIN_SUBSTRING_TERM = 4

QUALITY_TEXT = {"exact": "exakter Name", "word": "als ganzes Wort", "part": "als Wortbestandteil"}


_HASHES: dict[tuple[str, int, int], str] = {}


WRAP_WIDTH = 104
