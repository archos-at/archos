from __future__ import annotations

from typing import Any

import numpy as np

from .envelope import Answer
from .envelope import MissingFact
from .envelope import undecidable
from .model import SpatialModel


def _same_element(a_global_id: str, method: str) -> Answer[dict[str, Any]]:
    return undecidable(
        from_=[a_global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="clearWidth() hat zweimal dasselbe Bauteil bekommen",
            remedy=(
                "Ein lichtes Maß braucht zwei verschiedene Bauteile — die beiden Laibungen einer "
                "Öffnung, zwei Wände eines Gangs, Handlauf und Wand. Für das lichte Maß EINER Öffnung "
                "ist clearOpeningWidth() der richtige Aufruf, für die Höhe eines Raums clearHeight()."
            ),
            elements=[a_global_id],
        ),
    )


def _degenerate(
    model: SpatialModel, empty: Any, a_global_id: str, b_global_id: str, method: str
) -> Answer[dict[str, Any]]:
    return undecidable(
        from_=[a_global_id, b_global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=f"{empty.is_a()} „{model.label(empty) or empty.GlobalId}“ hat nur entartete Dreiecke",
            remedy=(
                "Der Körper dieses Bauteils besteht aus Dreiecken ohne Fläche — im Export ist die Form "
                "zusammengefallen (ein Profil mit Nullfläche, eine Extrusion der Länge 0). Das Bauteil im "
                "CAD neu aufziehen und erneut exportieren."
            ),
            elements=[empty.GlobalId],
        ),
    )


def _too_fine(
    tris_a: np.ndarray, tris_b: np.ndarray, a_global_id: str, b_global_id: str, method: str
) -> Answer[dict[str, Any]]:
    return undecidable(
        from_=[a_global_id, b_global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=(f"zu fein vernetzt für eine exakte Flächenmessung: {len(tris_a)} × {len(tris_b)} Dreiecke"),
            remedy=(
                "Das lichte Maß wird zwischen den Dreiecken beider Körper gemessen; bei dieser "
                "Netzfeinheit dauert das zu lange. Abhilfe: die Frage an den tragenden Bauteilen stellen "
                "statt an möblierten oder detaillierten Modellen (Wand gegen Wand statt Türblatt gegen "
                "Möbel), oder das Modell mit gröberer Tessellierung exportieren."
            ),
            elements=[a_global_id, b_global_id],
        ),
    )


def _aborted(
    seconds: float,
    tris_a: np.ndarray,
    tris_b: np.ndarray,
    tested: int,
    a_global_id: str,
    b_global_id: str,
    method: str,
) -> Answer[dict[str, Any]]:
    return undecidable(
        from_=[a_global_id, b_global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=(
                f"Messung nach {seconds:.0f} s abgebrochen ({len(tris_a)} × {len(tris_b)} Dreiecke, "
                f"{tested} exakte Paarvergleiche)"
            ),
            remedy=(
                "Diese beiden Körper liegen über eine große, fein vernetzte Fläche fast parallel "
                "zueinander — dabei ist kein Dreieckspaar ausschließbar. Abhilfe: einen kleineren "
                "Ausschnitt vergleichen (etwa die Laibung statt der ganzen Wand) oder das Modell mit "
                "gröberer Tessellierung exportieren. Ein Zwischenergebnis wird bewusst nicht gemeldet: "
                "eine abgebrochene Suche liefert eine OBERGRENZE, und eine Obergrenze als lichtes Maß zu "
                "lesen ist genau der Fehler, den diese Messung verhindern soll."
            ),
            elements=[a_global_id, b_global_id],
        ),
    )


def _no_aperture(
    model: SpatialModel, subject: Any, opening_or_filler_global_id: str, method: str
) -> Answer[dict[str, Any]]:
    name = model.label(subject) or subject.GlobalId
    return undecidable(
        from_=[opening_or_filler_global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=f"keine in einer senkrechten Ebene liegende Öffnungsfläche an {subject.is_a()} „{name}“",
            remedy=(
                "Das lichte Maß wird auf der Öffnungsebene gemessen. Diese Öffnung hat entweder keinen "
                "Körper im Export, oder sie liegt waagrecht (ein Dachflächenfenster in einem Flachdach) "
                "und hat damit keine senkrechte Ebene. Abhilfe: den Export mit Öffnungen und Füllungen "
                "sowie mit Körpergeometrie wiederholen. Für ein waagrechtes Fenster ist die lichte "
                "Öffnung im Grundriss zu messen — dafür ist extent() bzw. orientedExtent() zuständig."
            ),
            elements=[subject.GlobalId],
        ),
    )


def _no_footprint(model: SpatialModel, subject: Any, global_id: str, method: str) -> Answer[dict[str, Any]]:
    name = model.label(subject) or global_id
    return undecidable(
        from_=[global_id],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what=f"kein Grundriss an {subject.is_a()} „{name}“ — alle Punkte liegen auf einer Geraden",
            remedy=(
                "Der umschließende Rechteckkörper wird über den Grundriss des Bauteils gebildet. Dieses "
                "Bauteil hat keinen: sein Körper ist eine senkrechte Fläche ohne Dicke oder eine Linie "
                "(eine Achse, eine Annotation). Für ein flächiges Bauteil den Export mit echter "
                "Körpergeometrie wiederholen; für eine senkrechte Öffnungsfläche ist "
                "clearOpeningWidth() das passende Maß."
            ),
            elements=[global_id],
        ),
    )
