from __future__ import annotations

from typing import Any

from .envelope import Answer
from .envelope import MissingFact
from .envelope import undecidable
from .envelope_geometry_survey import SLOPE_REPORT_FRACTION
from .model import SpatialModel


def _no_envelope(method: str, surveyed: list[dict[str, Any]]) -> Answer[Any]:
    if not surveyed:
        return undecidable(
            from_=[],
            method=method,
            provenance="declared",
            missing=MissingFact(
                what="keine Bauteile der thermischen Hülle (Wand, Decke, Dach, Fenster, Tür, Paneel)",
                remedy=(
                    "Diese Datei enthält keinen einzigen IfcWall, IfcSlab, IfcRoof, IfcWindow, IfcDoor oder "
                    "IfcPlate. Entweder ist es kein Hochbaumodell (eine Infrastruktur- oder Geländedatei), oder "
                    "der Export enthält nur die räumliche Struktur ohne Bauteile."
                ),
            ),
        )
    candidates = [e["globalId"] for e in surveyed]
    return undecidable(
        from_=candidates,
        method=method,
        provenance="declared",
        missing=MissingFact(
            what="Pset_*Common.IsExternal und keine aus der Geometrie ableitbare Raumbegrenzung",
            remedy=(
                f"In dieser Datei stehen {len(candidates)} Bauteile, die zur thermischen Hülle gehören könnten, "
                "aber für keines davon ist entscheidbar, ob es außen liegt: es ist weder IsExternal deklariert "
                "noch berührt es genau einen Raum. Abhilfe: im CAD die Außenbauteile als außenliegend kennzeichnen "
                "(Pset_WallCommon.IsExternal und die entsprechenden Psets für Decke, Dach, Fenster, Tür, Paneel) "
                "und die Räume als IfcSpace mit Körpergeometrie mitexportieren. Ohne eines von beiden ist keine "
                "Hüllfläche bestimmbar, und eine geratene wäre in einer Energiebilanz nicht zu erkennen."
            ),
            elements=candidates or None,
        ),
    )


def _thermal_caveat(
    model: SpatialModel,
    inside: list[dict[str, Any]],
    without_area: list[dict[str, Any]],
    unknown: list[dict[str, Any]],
) -> str:
    caveat = (
        "Zugehörigkeit zur Hülle: erst die Deklaration (Pset_*Common.IsExternal), dann die Geometrie (ein "
        "Bauteil, das genau einen Raum begrenzt). Jeder Eintrag nennt unter „because“, welcher der beiden Wege "
        "ihn entschieden hat — die beiden sind nicht gleich belastbar. Kein Grenzwert, kein U-Wert-Höchstwert "
        "und keine Bewertung: erklärte U-Werte werden weitergereicht, nie aus den Schichten nachgerechnet."
    )
    slabs_inside = [e for e in inside if e["kind"] == "Boden/Decke" and e["area"]]
    if slabs_inside:
        named = ", ".join(f"{e['name'] or e['globalId']} ({e['area']:.3f} m²)" for e in slabs_inside[:3])
        caveat += (
            f" ACHTUNG: {len(slabs_inside)} Boden- bzw. Deckenbauteil(e) sind als IsExternal = False deklariert "
            f"und deshalb NICHT in der Hülle enthalten: {named}. In IFC heißt „external“ gegen Außenluft, "
            "während eine Bodenplatte gegen Erdreich nach OIB 6 sehr wohl zur wärmeübertragenden Hülle zählt. "
            "Diese Deklaration wird hier nicht überstimmt — das wäre eine Vermutung an der Stelle einer Aussage. "
            "Abhilfe: im CAD entscheiden, ob die Bodenplatte außenliegend gekennzeichnet gehört."
        )
    if without_area:
        caveat += (
            f" Für {len(without_area)} außenliegende(s) Bauteil(e) ist keine Fläche messbar; sie stehen mit "
            "area = null in der Liste und fehlen in der Summe, die insofern eine Untergrenze ist."
        )
    if unknown:
        caveat += (
            f" Bei {len(unknown)} Bauteil(en) ließ sich außen/innen nicht bestimmen — sie sind WEDER "
            "eingerechnet noch verworfen und stehen unter „unbestimmt“."
        )
    members = len(model.file.by_type("IfcMember"))
    if members:
        caveat += (
            f" Nicht enthalten sind {members} IfcMember (Pfosten und Riegel einer Vorhangfassade): gezählt "
            "werden Wände, Decken, Dächer, Fenster, Türen und Paneele. Bei einer Pfosten-Riegel-Fassade fehlt "
            "damit der Rahmenanteil."
        )
    return caveat


def _no_measured_area(method: str, outside: list[dict[str, Any]]) -> Answer[Any]:
    return undecidable(
        from_=[e["globalId"] for e in outside],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="keine messbare Fläche an den außenliegenden Bauteilen",
            remedy=(
                f"Die Datei kennzeichnet {len(outside)} Bauteile als außenliegend, aber keines davon trägt "
                "einen auswertbaren Körper. Das Modell mit Körpergeometrie neu exportieren "
                "(Body-Repräsentation, kein reiner Bounding-Box-Export)."
            ),
            elements=[e["globalId"] for e in outside],
        ),
    )


def _orientation_caveat(model: SpatialModel, horizontal: list[dict[str, Any]]) -> str:
    caveat = (
        "Transparent sind IfcWindow und IfcPlate, opak alles Übrige. Ein Paneel einer Vorhangfassade IST in "
        "diesem Modell verglast (System Panel:Glazed), aber der IFC-Typ sagt das nicht: ein Brüstungspaneel ist "
        "ebenfalls ein IfcPlate und wäre hier fälschlich als Glas gezählt. Eine verglaste Tür zählt umgekehrt "
        "als opak. Kein Grenzwert und keine Bewertung — der Fensterflächenanteil ist eine Messung."
    )
    if horizontal:
        caveat += (
            f" {len(horizontal)} waagrechte(s) Bauteil(e) (Dach, Decke, Bodenplatte) haben keine Himmelsrichtung "
            "und stehen unter „ohneAusrichtung“; sie sind in „opaque“/„transparent“ enthalten, aber in keiner "
            "Richtung."
        )

    if model.true_north is None:
        caveat += (
            " Diese Datei deklariert keine Nordrichtung "
            "(IfcGeometricRepresentationContext.TrueNorth), deshalb sind die Flächen OHNE Himmelsrichtungen "
            "ausgegeben. Sie werden nicht geraten: die Modellachse +Y ist nur dann Norden, wenn es jemand gesagt "
            "hat, und ein um 40° gedrehtes Gebäude bekäme sonst eine Südfassade, die es nicht hat. Abhilfe: die "
            "Nordrichtung im CAD setzen und mitexportieren."
        )
    return caveat


def _orientation_notes(by_orientation: dict[str, dict[str, Any]], unoriented: list[dict[str, Any]]) -> str:
    caveat = ""
    fully_glazed = [name for name, bucket in by_orientation.items() if bucket["windowWallRatio"] == 1.0]
    if fully_glazed:
        caveat += (
            f" Der Fensterflächenanteil ist auf {', '.join(sorted(fully_glazed))} genau 1,0 — an dieser Fassade "
            "ist keine opake Fläche gezählt. Das ist die Vorhangfassade: ihre Pfosten und Riegel sind IfcMember "
            "und gehören nicht zu den hier gezählten Bauteilarten, und die IfcCurtainWall selbst trägt keinen "
            "eigenen Körper. Der Rahmenanteil fehlt also, er ist nicht null."
        )
    if unoriented:
        caveat += (
            f" {len(unoriented)} senkrechte(s) Bauteil(e) haben keine bestimmbare Himmelsrichtung und sind in "
            "keiner Richtung enthalten, wohl aber in den Summen."
        )
    return caveat


def _no_measured_envelope(method: str, outside: list[dict[str, Any]]) -> Answer[Any]:
    return undecidable(
        from_=[e["globalId"] for e in outside],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="keine messbare Hüllfläche",
            remedy=(
                f"Die Datei kennzeichnet {len(outside)} Bauteile als außenliegend, aber keines trägt einen "
                "auswertbaren Körper — ohne Fläche gibt es kein A/V. Das Modell mit Körpergeometrie neu "
                "exportieren."
            ),
            elements=[e["globalId"] for e in outside],
        ),
    )


def _no_volume(method: str, measured: list[dict[str, Any]], spaces: Any) -> Answer[Any]:
    return undecidable(
        from_=[e["globalId"] for e in measured],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="kein IfcSpace mit auswertbarem Körper" if spaces else "IfcSpace",
            remedy=(
                "Das beheizte Volumen wird aus den Raumkörpern gebildet. Diese Datei enthält "
                + ("keine Räume" if not spaces else f"{len(spaces)} Räume, aber keiner davon trägt einen Körper")
                + ". Abhilfe: die Räume im CAD als IfcSpace mit Körpergeometrie exportieren. Ein Volumen aus "
                "der Hüllbox des Gebäudes wird bewusst nicht ersatzweise gebildet — es enthielte Loggien, "
                "Vordächer und den Luftraum über einem Pultdach und wäre in einer Energiebilanz nicht als "
                "falsch zu erkennen."
            ),
        ),
    )


def _zero_volume(method: str, measured: list[dict[str, Any]]) -> Answer[Any]:
    return undecidable(
        from_=[e["globalId"] for e in measured],
        method=method,
        provenance="computed",
        missing=MissingFact(
            what="beheiztes Volumen 0 m³",
            remedy=(
                "Die Raumkörper dieser Datei ergeben zusammen kein Volumen — sie sind flach oder entartet. "
                "Die Räume im CAD neu aufziehen und den Export prüfen."
            ),
        ),
    )


def _compactness_caveat(
    model: SpatialModel,
    measured: list[dict[str, Any]],
    volumes: list[dict[str, Any]],
    volume_answer: Answer[Any],
    without_area: list[dict[str, Any]],
    without_body: list[Any],
    spaces: Any,
) -> str:
    caveat = (
        f"A ist die Summe der außenliegenden Bauteilflächen ({len(measured)} Bauteile), gemessen an den "
        "AUSSENFLÄCHEN der Bauteile. V ist die Summe der Raumkörper, also ein NETTOVOLUMEN: Raumluft bis zu den "
        f"inneren Oberflächen, gebildet aus {len(volumes)} IfcSpace. Ein Bruttovolumen (bis zur Bauteilaußenkante) "
        "ist größer — bei 290 mm Außenwand und 470 mm Bodenaufbau bei einem Haus dieser Größe um einige "
        "Kubikmeter je Geschoss — und ist "
        "hier NICHT gebildet, weil dafür je Bauteil eine Dicke nötig wäre, die nur die Schichtaufbauten kennen. "
        "Das Verhältnis mischt damit eine Außenfläche mit einem Innenvolumen und liegt geringfügig über einem "
        "durchgehend brutto gebildeten A/V. Welches der beiden Volumina eine Berechnung meint, entscheidet die "
        "Berechnung; kein Grenzwert angewandt."
    )
    if volume_answer.caveat:
        caveat += f" {volume_answer.caveat}"
    if without_area:
        caveat += (
            f" {len(without_area)} außenliegende(s) Bauteil(e) ohne messbare Fläche sind in A nicht enthalten — "
            "A ist insofern eine Untergrenze und A/V zu klein."
        )
    if without_body:
        named = ", ".join(f"„{model.label(s) or s.GlobalId}“" for s in without_body[:5])
        rest = "" if len(without_body) <= 5 else f" und {len(without_body) - 5} weitere"
        caveat += (
            f" {len(without_body)} von {len(spaces)} IfcSpace tragen keinen auswertbaren Körper ({named}{rest}) "
            "und sind in V NICHT enthalten — V ist insofern eine Untergrenze und A/V zu groß. Aus demselben "
            "Grund ist auch ihr deklariertes Volumen nicht mitsummiert: beide Summen laufen über dieselben "
            "Räume, sonst wäre die Differenz als Widerspruch der Datei gemeldet, den es nicht gibt."
        )
    sloped = [
        e for e in measured if e["projectedArea"] and e["area"] > e["projectedArea"] * (1 + SLOPE_REPORT_FRACTION)
    ]
    if sloped:
        difference = sum(e["area"] - e["projectedArea"] for e in sloped)
        caveat += (
            f" {len(sloped)} Bauteil(e) sind geneigt oder gekrümmt; für sie ist die ABGEWICKELTE Oberfläche "
            f"gezählt, zusammen {difference:.3f} m² mehr als ihre Grundrissprojektion."
        )
    counted = [v for v in volumes if v["volume"] > 0]
    caveat += (
        f" Als beheizt gelten alle {len(counted)} ausgewerteten Raumkörper: eine Unterscheidung beheizt/unbeheizt "
        "steht in diesem Export nicht (weder IfcZone noch Pset_SpaceThermalRequirements). Ein unbeheizter "
        "Keller oder Dachraum ist damit mitgezählt und macht V zu groß und A/V zu klein."
    )
    return caveat
