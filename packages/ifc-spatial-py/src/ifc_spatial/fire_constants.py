"""Terms, slack and caveats the fire operators share, each named once."""

from __future__ import annotations

NOT_OCCUPIED_TERMS: tuple[str, ...] = (
    "dach",
    "attika",
    "technik",
    "haustechnik",
    "maschinenraum",
    "aufzugsmaschin",
    "lueftungszentrale",
    "roof",
    "plant",
    "attic",
    "mechanical",
)

BOUNDARY_TERMS: tuple[str, ...] = (
    "grundstuecksgrenze",
    "grundstueckgrenze",
    "grundgrenze",
    "bauplatzgrenze",
    "baugrundstueck",
    "parzelle",
    "vermessung",
    "site boundary",
    "property line",
    "plot boundary",
    "lot line",
)

SEPARATION_SLACK = 0.15

MIN_OVERLAP_AREA = 0.01

_FIRE_RATING_MEMO = "_ifc_spatial_fire_declares_rating"

_NO_BUILDING_CLASS = (
    "Diese Zahl ist eine HÖHE in Metern, keine Einstufung. Welche Gebäudeklasse sich daraus ergibt, "
    "bestimmt die OIB-Richtlinie 2 zusammen mit dem jeweiligen Landesrecht und hängt außerdem von der "
    "Anzahl der Geschoße, der Brutto-Grundfläche und der Nutzung ab — nichts davon ist eine geometrische "
    "Eigenschaft dieser Datei. Diese Bibliothek nennt deshalb keine Gebäudeklasse."
)

_GROUND_CAVEAT = (
    "Maßgeblich ist nach OIB das TIEFER gelegene anschließende Gelände. Ein Gelände ist in einem "
    "Architekturexport fast nie modelliert; welcher Bezug hier tatsächlich verwendet wurde, steht in "
    "„groundReference“ und muss gegen den Einreichplan geprüft werden. Fällt das Gelände zur Traufe hin ab, "
    "ist das wirkliche Fluchtniveau GRÖSSER als die hier gemeldete Zahl."
)
