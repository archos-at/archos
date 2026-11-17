from __future__ import annotations

import re
import unicodedata
from typing import Any

from ifc_spatial.briefing_constants import KIND_LABEL
from ifc_spatial.briefing_constants import MATCH_CONFIDENCE
from ifc_spatial.briefing_constants import MIN_SUBSTRING_TERM
from ifc_spatial.briefing_constants import QUALITY_TEXT
from ifc_spatial.briefing_lexicon import LEXICON
from ifc_spatial.briefing_records import ClassifiedRoom
from ifc_spatial.briefing_records import LexiconEntry

from .model import SpatialModel


def classify_rooms(model: SpatialModel) -> list[ClassifiedRoom]:
    lit_rooms = _window_assignment(model)
    out: list[ClassifiedRoom] = []

    for space in _spaces_of(model):
        global_id = space.GlobalId
        name = model.label(space)
        if name is None:
            out.append(
                ClassifiedRoom(
                    global_id=global_id,
                    name=None,
                    kind=None,
                    confidence=0.0,
                    because=[
                        "Der Raum trägt weder Name noch LongName — nichts, worauf sich eine Einstufung stützen könnte."
                    ],
                )
            )
            continue

        normalised = normalise(name)
        best: dict[str, tuple[LexiconEntry, str]] = {}
        for entry in LEXICON:
            quality = match_quality(normalised, entry.term)
            if quality is None:
                continue
            current = best.get(entry.kind)
            if current is None or len(entry.term) > len(current[0].term):
                best[entry.kind] = (entry, quality)

        if not best:
            out.append(
                ClassifiedRoom(
                    global_id=global_id,
                    name=name,
                    kind=None,
                    confidence=0.0,
                    because=[f'Der Name „{name}" passt zu keinem Lexikoneintrag.'],
                )
            )
            continue

        ranked = sorted(best.items(), key=lambda item: (-len(item[1][0].term), -MATCH_CONFIDENCE[item[1][1]]))
        kind, (winner, quality) = ranked[0]
        runner_up = ranked[1] if len(ranked) > 1 else None

        because = [f'Name „{name}" enthält „{winner.term}" ({QUALITY_TEXT[quality]}) → {KIND_LABEL[kind]}.']
        confidence = MATCH_CONFIDENCE[quality]

        if winner.weak:
            confidence = min(confidence, 0.55)
            because.append(winner.note or f'„{winner.term}" ist ein schwaches Signal.')
        elif winner.note:
            because.append(winner.note)

        if runner_up is not None:
            other_kind, (other, _) = runner_up
            if len(other.term) == len(winner.term):
                confidence *= 0.85
                because.append(f'Mehrdeutig: „{other.term}" spricht gleich stark für {KIND_LABEL[other_kind]}.')
            else:
                because.append(
                    f'„{winner.term}" schlägt „{other.term}" ({KIND_LABEL[other_kind]}) als längerer Treffer.'
                )

        if lit_rooms is not None:
            if global_id in lit_rooms:
                confidence += 0.05
                because.append("Dem Raum ist mindestens ein Fenster zugeordnet (opensTo).")
            elif kind == "habitable_room":
                confidence -= 0.05
                because.append("Diesem Raum ist kein Fenster zugeordnet, obwohl das Modell Fensterzuordnungen führt.")

        out.append(
            ClassifiedRoom(
                global_id=global_id,
                name=name,
                kind=kind,
                confidence=round(min(0.95, max(0.3, confidence)) * 100) / 100,
                because=because,
            )
        )

    return out


def match_quality(normalised: str, term: str) -> str | None:
    if normalised == term:
        return "exact"
    if re.search(rf"(^| ){re.escape(term)}( |$)", normalised):
        return "word"
    if len(term) >= MIN_SUBSTRING_TERM and term in normalised:
        return "part"
    return None


def normalise(raw: str) -> str:
    text = unicodedata.normalize("NFC", raw).lower()
    for umlaut, expansion in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(umlaut, expansion)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()




def _by_type(model: SpatialModel, ifc_type: str) -> list[Any]:
    try:
        return list(model.file.by_type(ifc_type))
    except RuntimeError:
        return []


def _spaces_of(model: SpatialModel) -> list[Any]:
    return [*_by_type(model, "IfcSpace"), *_by_type(model, "IfcSpatialZone")]


def _window_assignment(model: SpatialModel) -> set[str] | None:
    lit: set[str] = set()
    boundaries = _by_type(model, "IfcRelSpaceBoundary")
    if boundaries:
        for rel in boundaries:
            element = rel.RelatedBuildingElement
            space = rel.RelatingSpace
            if element is not None and space is not None and element.is_a("IfcWindow"):
                lit.add(space.GlobalId)
        return lit

    contacts: dict[str, set[str]] = {}
    for cached in getattr(model, "_space_contacts", {}).values():
        for space_id, touching in cached.items():
            contacts.setdefault(space_id, set()).update(touching)
    if not contacts:
        return None
    for space_id, touching in contacts.items():
        for global_id in touching:
            try:
                element = model.file.by_guid(global_id)
            except RuntimeError, KeyError:
                continue
            if element.is_a("IfcWindow"):
                lit.add(space_id)
    return lit
