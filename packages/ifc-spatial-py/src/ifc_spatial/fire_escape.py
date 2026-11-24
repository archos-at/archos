from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ifc_spatial.fire_constants import _GROUND_CAVEAT
from ifc_spatial.fire_constants import _NO_BUILDING_CLASS
from ifc_spatial.fire_distance import _matching_term
from ifc_spatial.fire_distance import _metres
from ifc_spatial.fire_records import StoreyJudgement

from .briefing import classify_rooms
from .envelope import Answer
from .envelope import MissingFact
from .envelope import inferred
from .envelope import undecidable
from .model import SpatialModel


def escape_level(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "escape_level(model)"
    storeys = model.storeys
    if not storeys:
        return undecidable(
            from_=[],
            method=method,
            provenance="inferred",
            missing=MissingFact(
                what="IfcBuildingStorey",
                remedy=(
                    "Dieser Export enthält keine Geschoße. Geschoße im CAD anlegen und mit ihrer Höhenlage "
                    "(Elevation) mitexportieren — ohne Geschoßebenen gibt es kein Fußbodenniveau, dessen Höhe "
                    "gemessen werden könnte."
                ),
            ),
        )

    with_elevation = [s for s in storeys if s.elevation is not None]
    if not with_elevation:
        return undecidable(
            from_=[s.global_id for s in storeys],
            method=method,
            provenance="inferred",
            missing=MissingFact(
                what="IfcBuildingStorey.Elevation",
                remedy=(
                    f"Dieser Export enthält {len(storeys)} Geschoß(e), aber keines davon deklariert eine "
                    "Höhenlage. Im CAD die Geschoßhöhen setzen und neu exportieren — aus der Reihenfolge der "
                    "Geschoße allein lässt sich keine Höhe bilden, und eine geschätzte Geschoßhöhe wäre in der "
                    "Antwort nicht mehr als Schätzung erkennbar."
                ),
                elements=[s.global_id for s in storeys],
            ),
        )

    judgements = _judge_storeys(model, storeys)
    counted = [j for j in judgements if j.counted and j.elevation is not None]
    if not counted:
        return undecidable(
            from_=[j.global_id for j in judgements],
            method=method,
            provenance="inferred",
            missing=MissingFact(
                what="ein Geschoß, das erkennbar zum Aufenthalt von Menschen bestimmt ist",
                remedy=(
                    "Auf keinem Geschoß dieses Exports deutet etwas auf Aufenthalt hin: entweder trägt jedes "
                    "Geschoß einen Namen aus dem Technik-/Dachbereich, oder alle Räume darauf sind Neben- und "
                    "Erschließungsflächen. Abhilfe: Räume als IfcSpace mit sprechendem Namen bzw. LongName "
                    "exportieren und Pset_SpaceCommon setzen. Die Einstufung „zum Aufenthalt bestimmt“ ist "
                    "eine Nutzungsangabe und steht nicht in der Geometrie."
                ),
                elements=[j.global_id for j in judgements],
            ),
        )

    top = max(counted, key=lambda j: (j.elevation, j.global_id))
    ground = _ground_reference(model)
    if ground is None:
        return undecidable(
            from_=[top.global_id],
            method=method,
            provenance="inferred",
            missing=MissingFact(
                what="ein Geländebezug (IfcSite mit Körpergeometrie, sonst eine Geschoßhöhenlage)",
                remedy=(
                    "Weder ein Geländemodell noch eine deklarierte Geschoßhöhenlage noch auswertbare "
                    "Bauteilgeometrie ist vorhanden. Ohne einen unteren Bezugspunkt ist eine Höhe ÜBER etwas "
                    "nicht bildbar. Abhilfe: das Gelände als IfcSite mit Körpergeometrie exportieren."
                ),
            ),
        )

    value = round(float(top.elevation) - ground["z"], 4)
    because, confidence = _escape_level_reasons(judgements, top, ground)

    caveat = [_NO_BUILDING_CLASS, _GROUND_CAVEAT]
    caveat.append(
        f"Gezählt wurden {len(counted)} von {len(judgements)} Geschoß(en); maßgeblich ist "
        f"„{top.name or top.global_id}“ auf {_metres(top.elevation)}. Die vollständige Liste mit Begründung "
        "je Geschoß steht unter „storeys“ — ein Geschoß, das hier falsch eingestuft ist, lässt sich dort "
        "benennen und die Zahl mit einer Subtraktion korrigieren."
    )
    dropped = [j for j in judgements if not j.counted]
    if dropped:
        caveat.append("NICHT gezählt: " + ", ".join(f"„{j.name or j.global_id}“ ({j.why})" for j in dropped) + ".")
    caveat.append(
        "Gemessen wird auf die deklarierte Geschoßebene (Rohbau-Oberkante), nicht auf den fertigen Fußboden; "
        "ein Fußbodenaufbau darüber hebt das wirkliche Fußbodenniveau um seine Dicke an."
    )

    return inferred(
        {
            "escape_level": value,
            "topOccupiedFloor": {
                "globalId": top.global_id,
                "name": top.name,
                "elevation": top.elevation,
            },
            "groundReference": ground,
            "storeys": [j.to_dict() for j in judgements],
        },
        unit="m",
        from_=[top.global_id, *ground["from"]],
        method=method,
        confidence=confidence,
        because=because,
        caveat=" ".join(caveat),
    )


def _judge_storeys(model: SpatialModel, storeys: Sequence[Any]) -> list[StoreyJudgement]:
    rooms = {room.global_id: room for room in classify_rooms(model)}
    per_storey: dict[str, list[Any]] = {}
    for space in model.file.by_type("IfcSpace"):
        storey = model.storey_of(space)
        if storey is not None:
            per_storey.setdefault(storey.GlobalId, []).append(space)

    out: list[StoreyJudgement] = []
    for storey in sorted(storeys, key=lambda s: (s.elevation is None, s.elevation or 0.0, s.global_id)):
        spaces = per_storey.get(storey.global_id, [])
        described = [
            {
                "globalId": space.GlobalId,
                "name": model.label(space),
                "use": rooms[space.GlobalId].kind if space.GlobalId in rooms else None,
            }
            for space in spaces
        ]

        counted, why = _judge_one_storey(storey, described)

        out.append(
            StoreyJudgement(
                global_id=storey.global_id,
                name=storey.name,
                elevation=storey.elevation,
                counted=counted and storey.elevation is not None,
                why=(
                    why
                    if storey.elevation is not None
                    else why + ", aber dieses Geschoß deklariert keine Höhenlage und kann deshalb nicht maßgeblich sein"
                ),
                spaces=described,
            )
        )
    return out


def _judge_one_storey(storey: Any, described: Sequence[dict[str, Any]]) -> tuple[bool, str]:
    habitable = [entry for entry in described if entry["use"] == "habitable_room"]
    placed = [entry for entry in described if entry["use"] is not None]
    unplaced = [entry for entry in described if entry["use"] is None]

    if habitable:
        return (
            True,
            f"{len(habitable)} von {len(described)} Raum/Räumen auf diesem Geschoß sind dem Lexikon "
            f"nach Aufenthaltsräume (z. B. „{habitable[0]['name']}“)",
        )
    if described and not unplaced:
        return (
            False,
            f"Alle {len(described)} Räume auf diesem Geschoß sind dem Lexikon nach Neben- oder "
            f"Erschließungsflächen (z. B. „{placed[0]['name']}“) — kein Raum, in dem sich Menschen "
            "dauernd aufhalten",
        )

    hit = _matching_term(storey.name)
    corroborating = [(entry, _matching_term(entry["name"])) for entry in unplaced]
    if hit is not None and all(term is not None for _, term in corroborating):
        if not described:
            return (
                False,
                f"Geschoßname „{storey.name}“ enthält „{hit}“ — das deutet auf ein Technik-, Dach- oder "
                "Attikageschoß und damit nicht auf Aufenthalt; ein Raum, der dem widerspräche, ist auf "
                "diesem Geschoß nicht exportiert",
            )
        return (
            False,
            f"Geschoßname „{storey.name}“ enthält „{hit}“ — das deutet auf ein Technik-, Dach- oder "
            f"Attikageschoß und damit nicht auf Aufenthalt; die Raumnamen bestätigen das "
            f"(z. B. „{corroborating[0][0]['name']}“ enthält „{corroborating[0][1]}“) und kein Raum "
            "dieses Geschoßes ist dem Lexikon nach ein Aufenthaltsraum",
        )

    if not described:
        return (
            True,
            "Auf diesem Geschoß ist kein IfcSpace exportiert — über die Nutzung sagt die Datei nichts. "
            "Im Zweifel MITGEZÄHLT: ein zu niedrig gemeldetes Fluchtniveau ist die gefährliche Richtung",
        )
    naming = (
        f"; der Geschoßname enthält zwar „{hit}“, wird aber von den Raumnamen nicht bestätigt"
        if hit is not None
        else ""
    )
    return (
        True,
        f"{len(unplaced)} von {len(described)} Raumnamen passen zu keinem Lexikoneintrag; die Nutzung "
        f"dieses Geschoßes ist damit offen{naming}. Im Zweifel MITGEZÄHLT: ein zu niedrig gemeldetes "
        "Fluchtniveau ist die gefährliche Richtung",
    )


def _ground_reference(model: SpatialModel) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []

    site_low: float | None = None
    site_id: str | None = None
    for site in model.file.by_type("IfcSite"):
        geo = model.geometry(site.GlobalId)
        if geo is None:
            continue
        low = float(geo.box[0][2])
        if site_low is None or low < site_low:
            site_low, site_id = low, site.GlobalId
    if site_low is not None and site_id is not None:
        candidates.append(
            {
                "z": round(site_low, 4),
                "via": "IfcSite-Körpergeometrie, tiefster Punkt des modellierten Geländes",
                "from": [site_id],
            }
        )

    elevations = [s for s in model.storeys if s.elevation is not None]
    if elevations:
        lowest = min(elevations, key=lambda s: (s.elevation, s.global_id))
        candidates.append(
            {
                "z": round(float(lowest.elevation), 4),
                "via": (
                    f"tiefste deklarierte Geschoßebene „{lowest.name or lowest.global_id}“ "
                    "(IfcBuildingStorey.Elevation) — eine FUSSBODENebene, kein Gelände"
                ),
                "from": [lowest.global_id],
            }
        )

    if model.bounds is not None:
        candidates.append(
            {
                "z": round(float(model.bounds[0][2]), 4),
                "via": "tiefster Punkt der Modellgeometrie (Unterkante des untersten Bauteils) — kein Gelände",
                "from": [],
            }
        )

    if not candidates:
        return None

    chosen = dict(candidates[0])
    declared_elevations = [
        {
            "refElevation": float(site.RefElevation),
            "globalId": site.GlobalId,
            "via": "IfcSite.RefElevation (Meereshöhe)",
        }
        for site in model.file.by_type("IfcSite")
        if getattr(site, "RefElevation", None) is not None
    ]
    chosen["candidates"] = candidates
    chosen["nichtVerwendet"] = declared_elevations
    return chosen


def _escape_level_reasons(
    judgements: Sequence[StoreyJudgement], top: StoreyJudgement, ground: dict[str, Any]
) -> tuple[list[str], float]:
    because = [
        f"Oberstes mitgezähltes Geschoß: „{top.name or top.global_id}“ auf {_metres(top.elevation)} ({top.why}).",
        f"Unterer Bezug: {ground['via']}, {_metres(ground['z'])}.",
        f"{sum(1 for j in judgements if j.counted)} von {len(judgements)} Geschoß(en) als zum Aufenthalt "
        "bestimmt gewertet; die Begründung je Geschoß steht in „storeys“.",
    ]
    confidence = 0.85
    if not ground["via"].startswith("IfcSite"):
        confidence -= 0.15
        because.append(
            "Kein Geländemodell in dieser Datei — der untere Bezug ist eine Bauwerkskante, nicht das "
            "anschließende Gelände."
        )
    uncertain = [j for j in judgements if j.counted and "Im Zweifel" in j.why]
    if uncertain:
        confidence -= 0.15
        because.append(
            f"{len(uncertain)} Geschoß(e) wurden ohne positives Nutzungssignal mitgezählt — das ist die "
            "vorsichtige Richtung und macht die Zahl eher zu groß als zu klein."
        )
    if top is judgements[-1] and not any(not j.counted for j in judgements):
        because.append("Kein Geschoß musste ausgeschieden werden; das oberste Geschoß ist das maßgebliche.")
    return because, round(max(0.3, confidence), 2)
