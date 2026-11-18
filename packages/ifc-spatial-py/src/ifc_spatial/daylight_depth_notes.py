from __future__ import annotations

from typing import Any

from .envelope import Answer
from .envelope import MissingFact
from .envelope import undecidable
from .model import SpatialModel

CORNER_ROOM_SHARE = 0.5
RECTANGULARITY_TOLERANCE = 0.005


def _no_facade(
    model: SpatialModel,
    space_global_id: str,
    method: str,
    candidates: list[dict[str, Any]],
    curtain_wall: list[Any],
) -> Answer[Any]:
    if candidates:
        what = "keine außenliegende Fensteröffnung an den Außenwänden dieses Raums"
        remedy = (
            f"Dieser Raum wird von {len(candidates)} Außenwand/Außenwänden begrenzt, aber keine davon trägt "
            "eine messbare, nach außen gerichtete Öffnung. Entweder hat der Raum kein Fenster — dann gibt es "
            "keine Belichtungsfassade und keine Raumtiefe zu ihr — oder der Export hat die Öffnungen ohne "
            "Geometrie geschrieben. Abhilfe: mit Öffnungen und Füllungen neu exportieren, oder roomDepth() "
            "mit der gewünschten Fassade als zweitem Argument aufrufen."
        )
    else:
        what = "keine als außenliegend deklarierte Wand begrenzt diesen Raum"
        remedy = (
            "Die Belichtungsfassade wird unter den Außenwänden des Raums gesucht, und außen heißt hier: "
            "Pset_WallCommon.IsExternal ist an der Wand gesetzt. In diesem Modell ist das für keine "
            "begrenzende Wand der Fall. Abhilfe: IsExternal an den Außenwänden setzen und neu exportieren, "
            "oder roomDepth() mit der gewünschten Fassade als zweitem Argument aufrufen."
        )
    if curtain_wall:
        remedy += (
            f" Hinweis: {len(curtain_wall)} Bauteil(e) einer Vorhangfassade (IfcPlate/IfcMember) begrenzen "
            "diesen Raum. Vorhangfassaden tragen ihre Verglasung ohne IfcOpeningElement und werden hier "
            "nicht als Öffnung gezählt — sie sind aber eine Belichtungsfassade und können ausdrücklich "
            "übergeben werden."
        )
    return undecidable(
        from_=[space_global_id, *[c["globalId"] for c in candidates]],
        method=method,
        provenance="computed",
        missing=MissingFact(what=what, remedy=remedy, elements=[space_global_id]),
    )


def _depth_caveat(
    model: SpatialModel,
    *,
    chosen: dict[str, Any] | None,
    candidates: list[dict[str, Any]],
    facade_id: str,
    outward: bool,
    depth: float,
    width: float,
    floor_value: float | None,
    height: Answer[float],
    height_value: float | None,
    from_footprint: bool,
    curtain_wall: list[Any],
    bounding: Answer[Any],
    caller_supplied: bool,
) -> str:
    parts: list[str] = [
        "Tiefe und Breite sind aus dem Grundriss des Raumkörpers gemessen, auf die Fassadennormale bzw. auf "
        "die Fassadenrichtung projiziert — NICHT aus der achsparallelen Hüllbox. Für einen zur Modellachse "
        "verdrehten Raum wären die Boxmaße systematisch zu groß."
    ]

    parts.extend(
        _choice_notes(caller_supplied=caller_supplied, chosen=chosen, candidates=candidates, facade_id=facade_id)
    )

    if not outward:
        parts.append(
            "Die Außenseite dieser Fassadenebene ist ungesichert (das Bauteil steht zu nahe an der "
            "Grundriss-Mitte). Die Tiefe selbst ist davon unberührt — sie ist eine Ausdehnung, kein "
            "Vorzeichen — die genannte Himmelsrichtung kann aber um 180° gedreht sein."
        )
    parts.append(_height_note(height, height_value))

    if floor_value is not None:
        parts.append(_rectangle_note(depth * width, floor_value))

    if not from_footprint:
        parts.append(
            "Der Raumkörper hat keine waagrechte Fläche, aus der sich ein Grundriss bilden ließe — gemessen "
            "ist die Projektion aller Körperpunkte. Für einen senkrechten Raumkörper ist das dieselbe "
            "Silhouette; für einen geneigten ist sie größer als der Boden."
        )

    if curtain_wall:
        names = ", ".join(sorted({(model.label(e) or e.GlobalId).split(":")[0] for e in curtain_wall}))
        parts.append(
            f"{len(curtain_wall)} Bauteil(e) einer Vorhangfassade ({names}) begrenzen diesen Raum und sind in "
            "der Fassadenwahl NICHT enthalten: Vorhangfassaden tragen ihre Verglasung als IfcPlate/IfcMember "
            "ohne IfcOpeningElement, ihre Öffnungsfläche ist mit demselben Maß nicht messbar. Wenn die "
            "Belichtung über die Glasfassade läuft, roomDepth() mit einem ihrer Bauteile als Fassade aufrufen."
        )

    if bounding.provenance == "computed" and bounding.caveat:
        parts.append(f"Raumbegrenzung: {bounding.caveat}")

    return " ".join(parts)


def _choice_notes(
    *,
    caller_supplied: bool,
    chosen: dict[str, Any] | None,
    candidates: list[dict[str, Any]],
    facade_id: str,
) -> list[str]:
    parts: list[str] = []
    if caller_supplied and chosen is None:
        parts.append(
            "Die Fassade wurde übergeben und gehört nicht zu den außenliegenden Wänden, die dieser Raum "
            "über bounds() als Begrenzung führt — die Tiefe ist trotzdem senkrecht zu ihr gemessen."
        )
    runners = [c for c in candidates if c["globalId"] != facade_id and float(c["apertureArea"]) > 0]
    if chosen is None or not runners:
        return parts
    best = float(chosen["apertureArea"])
    second = runners[0]
    share = float(second["apertureArea"]) / best if best > 0 else 0.0
    listed = ", ".join(f"{c['name'] or c['globalId']} ({float(c['apertureArea']):.3f} m²)" for c in runners[:3])
    with_openings = [c for c in candidates if float(c["apertureArea"]) > 0]
    more = "" if len(runners) <= 3 else f" (die 3 größten von {len(runners)})"
    parts.append(
        f"Dieser Raum hat {len(with_openings)} Außenwand/Außenwände mit Öffnungen (von "
        f"{len(candidates)} begrenzenden Außenwänden insgesamt); "
        + ("gewählt ist eine davon. " if float(chosen["apertureArea"]) > 0 else "die gewählte trägt keine. ")
        + f"Weitere{more}: {listed}. Zu jeder gehört eine andere Raumtiefe."
    )
    if share >= CORNER_ROOM_SHARE:
        parts.append(
            f"Die zweitgrößte Fassade trägt {share * 100:.0f} % der Öffnungsfläche der gewählten — das ist "
            "ein Eckraum, und die Wahl ist keine deutliche. Für die andere Richtung roomDepth() mit "
            f"facade={second['globalId']} aufrufen."
        )
    return parts


def _height_note(height: Answer[float], height_value: float | None) -> str:
    if height_value is None:
        return "Ohne lichte Höhe ist kein Verhältnis Tiefe/Höhe gebildet: " + (
            (height.missing.what + ". " + height.missing.remedy) if height.missing else "clearHeight() liefert nichts."
        )
    return (
        f"Das Verhältnis Tiefe/Höhe ist gegen die LICHTE Höhe {height_value:.3f} m gebildet (clearHeight, "
        "senkrecht nach oben gemessen), nicht gegen die Höhe des Raumkörpers. Abgehängte Decken und "
        "Unterzüge verkürzen die lichte Höhe, ohne den Raumkörper zu verkürzen; das Verhältnis gegen den "
        "Raumkörper fiele günstiger aus und wäre die unsichere Seite."
    )


def _rectangle_note(product: float, floor_value: float) -> str:
    delta = abs(product - floor_value) / floor_value if floor_value else 0.0
    if delta <= RECTANGULARITY_TOLERANCE:
        return (
            f"Gegenprobe: Tiefe × Breite = {product:.4f} m² gegen die gemessene Bodenfläche "
            f"{floor_value:.4f} m² ({delta * 100:.2f} % Abweichung) — der Grundriss füllt das Rechteck "
            "aus Tiefe und Breite aus, die Tiefe gilt damit über die ganze Breite."
        )
    return (
        f"Gegenprobe: Tiefe × Breite = {product:.4f} m² gegen die gemessene Bodenfläche "
        f"{floor_value:.4f} m² ({delta * 100:.2f} % Abweichung). Dieser Raum ist NICHT rechteckig — "
        "Tiefe und Breite sind die größten Ausdehnungen und gelten nicht an jeder Stelle. Das Produkt "
        "ist keine Fläche des Raums; die Fläche liefert floorArea()."
    )
