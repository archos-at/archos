from __future__ import annotations

from typing import Any

import ifcopenshell.util.element as ue
import numpy as np

from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import declared
from .envelope import triangulate
from .envelope import undecidable
from .geometry import triangle_normals_areas
from .model import SpatialModel
from .operators import AREA_RELATIVE_TOLERANCE
from .operators import COMPASS
from .operators import _clear_opening_area
from .operators import _faces_outside
from .operators import _footprint_area
from .operators import _rooms_on_one_side
from .operators import azimuth
from .operators import enclosed_by


_KIND_OF_TYPE: dict[str, str] = {
    "IfcWall": "Wand",
    "IfcWallStandardCase": "Wand",
    "IfcCurtainWall": "Wand",
    "IfcSlab": "Boden/Decke",
    "IfcRoof": "Dach",
    "IfcWindow": "Fenster",
    "IfcWindowStandardCase": "Fenster",
    "IfcDoor": "Tür",
    "IfcDoorStandardCase": "Tür",
    "IfcPlate": "Verglasungsfeld",
}

KIND_ORDER = ["Wand", "Fenster", "Tür", "Verglasungsfeld", "Boden/Decke", "Dach"]

TRANSPARENT_TYPES = {"IfcWindow", "IfcWindowStandardCase", "IfcPlate"}

_OPENING_TYPES = {"IfcWindow", "IfcWindowStandardCase", "IfcDoor", "IfcDoorStandardCase", "IfcPlate"}

VOLUME_RELATIVE_TOLERANCE = 1.5 * AREA_RELATIVE_TOLERANCE

_HORIZONTAL_NORMAL_TOLERANCE = 0.01

SLOPE_REPORT_FRACTION = 0.01




def _declared_u_value(element: Any) -> tuple[float | None, str | None]:
    psets = ue.get_psets(element, qtos_only=False) or {}
    for pset_name, values in psets.items():
        if not isinstance(values, dict):
            continue
        found = values.get("ThermalTransmittance")
        if isinstance(found, (int, float)) and not isinstance(found, bool):
            return float(found), f"{pset_name}.ThermalTransmittance"
    return None, None


def _developed_horizontal_area(triangles: np.ndarray) -> float:
    normals, areas = triangle_normals_areas(triangles)
    upward = normals[:, 2]
    return max(
        float(areas[upward > _HORIZONTAL_NORMAL_TOLERANCE].sum()),
        float(areas[upward < -_HORIZONTAL_NORMAL_TOLERANCE].sum()),
    )


def _element_area(model: SpatialModel, element: Any) -> dict[str, Any]:
    geometry = model.geometry(element.GlobalId)
    if geometry is None:
        reason = model.geometry_failure(element.GlobalId) or ""
        if reason.startswith(("shape-failed", "empty-mesh")):
            why = "Körpergeometrie vorhanden, aber vom Geometriekern nicht auswertbar"
        elif element.is_a() == "IfcCurtainWall":
            why = "kein eigener Körper — eine Vorhangfassade trägt ihre Geometrie über Paneele und Pfosten"
        else:
            why = "keine Körpergeometrie in dieser Datei"
        return {"area": None, "projectedArea": None, "via": why, "horizontal": None}

    vertical = _clear_opening_area(model, element)
    projected = _footprint_area(geometry.triangles)

    if vertical is not None and vertical >= projected:
        return {
            "area": round(vertical, 6),
            "projectedArea": round(vertical, 6),
            "via": "Ansichtsfläche in der Bauteilebene (Öffnungen abgezogen)",
            "horizontal": False,
        }
    if projected <= 0.0:
        return {
            "area": None,
            "projectedArea": None,
            "via": "Körper ohne auswertbare Fläche (weder senkrechte Ebene noch Grundrissfläche)",
            "horizontal": None,
        }

    developed = _developed_horizontal_area(geometry.triangles)
    area = max(developed, projected)
    return {
        "area": round(area, 6),
        "projectedArea": round(projected, 6),
        "via": (
            "abgewickelte Oberfläche (geneigt oder gekrümmt)"
            if area > projected * (1.0 + SLOPE_REPORT_FRACTION)
            else "Grundrissprojektion"
        ),
        "horizontal": True,
    }


ROUTE_DECLARED = "IsExternal (deklariert)"
ROUTE_BOUNDED_SPACES = "Raumbegrenzung"
ROUTE_UNDECIDED = "undetermined"


def _external_route(model: SpatialModel, element: Any) -> tuple[bool | None, str, str]:
    if element.is_a() in _OPENING_TYPES:
        outside, why = _faces_outside(model, element)
        if outside is None:
            return None, ROUTE_UNDECIDED, why
        route = ROUTE_DECLARED if why.startswith("Pset_") else ROUTE_BOUNDED_SPACES
        return outside, route, why

    own = model.declared_property(element, ("IsExternal",))
    if isinstance(own, bool):
        return own, ROUTE_DECLARED, "Pset_*Common.IsExternal am Bauteil selbst (deklariert)"

    spaces = enclosed_by(model, element.GlobalId)
    if spaces.decidable and spaces.value is not None:
        source = "deklarierte Raumgrenzen" if spaces.provenance == "declared" else "aus der Geometrie abgeleitet"
        count = len(spaces.value)
        if count >= 2:
            side = _rooms_on_one_side(model, element, spaces.value)
            if side is False:
                return (
                    False,
                    ROUTE_BOUNDED_SPACES,
                    f"begrenzt {count} Räume auf beiden Seiten (Trennbauteil, {source})",
                )
            if side is True:
                return (
                    True,
                    ROUTE_BOUNDED_SPACES,
                    f"begrenzt {count} Räume, aber alle auf derselben Seite — "
                    f"auf der anderen liegt kein IfcSpace ({source})",
                )
            return (
                False,
                ROUTE_BOUNDED_SPACES,
                f"begrenzt {count} Räume (Trennbauteil, {source}) — auf welcher Seite sie liegen, "
                "war ohne Körper nicht prüfbar",
            )
        if count == 1:
            return (
                True,
                ROUTE_BOUNDED_SPACES,
                f"begrenzt genau einen Raum — auf der anderen Seite liegt kein IfcSpace ({source})",
            )
        return None, ROUTE_UNDECIDED, f"berührt keinen Raum ({source}) — daraus folgt weder außen noch innen"
    return None, ROUTE_UNDECIDED, "weder IsExternal deklariert noch aus den Raumberührungen ableitbar"


def _survey(model: SpatialModel) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for element in model.file.by_type("IfcProduct"):
        kind = _KIND_OF_TYPE.get(element.is_a())
        if kind is None:
            continue
        external, route, because = _external_route(model, element)
        entry: dict[str, Any] = {
            "globalId": element.GlobalId,
            "ifcType": element.is_a(),
            "name": model.label(element),
            "kind": kind,
            "external": external,
            "route": route,
            "because": because,
            "transparent": element.is_a() in TRANSPARENT_TYPES,
        }
        entry.update(_element_area(model, element))
        u_value, u_path = _declared_u_value(element)
        entry["thermalTransmittance"] = u_value
        entry["thermalTransmittanceVia"] = u_path
        found.append(entry)
    found.sort(key=lambda e: (KIND_ORDER.index(e["kind"]), e["globalId"]))
    return found


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




def thermal_envelope(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "thermalEnvelope()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    inside = [e for e in surveyed if e["external"] is False]
    unknown = [e for e in surveyed if e["external"] is None]
    if not outside:
        return _no_envelope(method, surveyed)

    by_kind: dict[str, list[dict[str, Any]]] = {}
    area_by_kind: dict[str, float] = {}
    for entry in outside:
        by_kind.setdefault(entry["kind"], []).append(entry)
        if entry["area"] is not None:
            area_by_kind[entry["kind"]] = round(area_by_kind.get(entry["kind"], 0.0) + entry["area"], 6)

    measured = [e for e in outside if e["area"] is not None]
    without_area = [e for e in outside if e["area"] is None]
    total = round(sum(e["area"] for e in measured), 6) if measured else None

    routes: dict[str, int] = {}
    for entry in outside:
        routes[entry["route"]] = routes.get(entry["route"], 0) + 1

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

    return computed(
        {
            "byKind": {kind: by_kind[kind] for kind in KIND_ORDER if kind in by_kind},
            "areaByKind": area_by_kind,
            "totalArea": total,
            "elementCount": len(outside),
            "routes": routes,
            "interior": inside,
            "undetermined": unknown,
        },
        unit="m²",
        tolerance=abs(total) * AREA_RELATIVE_TOLERANCE if total else None,
        from_=[e["globalId"] for e in outside],
        method=method,
        caveat=caveat,
    )


def envelope_area_by_orientation(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "envelopeAreaByOrientation()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    if not outside:
        return _no_envelope(method, surveyed)

    measured = [e for e in outside if e["area"] is not None]
    if not measured:
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

    vertical = [e for e in measured if e["horizontal"] is False]
    horizontal = [e for e in measured if e["horizontal"] is not False]
    opaque_total = round(sum(e["area"] for e in measured if not e["transparent"]), 6)
    transparent_total = round(sum(e["area"] for e in measured if e["transparent"]), 6)
    whole = opaque_total + transparent_total

    payload: dict[str, Any] = {
        "orientationKnown": model.true_north is not None,
        "opaque": opaque_total,
        "transparent": transparent_total,
        "total": round(whole, 6),
        "windowWallRatio": round(transparent_total / whole, 6) if whole > 0 else None,
        "ohneAusrichtung": [
            {"globalId": e["globalId"], "name": e["name"], "kind": e["kind"], "area": e["area"]} for e in horizontal
        ],
    }

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
        return computed(
            payload,
            unit="m²",
            tolerance=abs(whole) * AREA_RELATIVE_TOLERANCE,
            from_=[e["globalId"] for e in measured],
            method=method,
            caveat=caveat,
        )

    by_orientation: dict[str, dict[str, Any]] = {}
    unoriented: list[dict[str, Any]] = []
    for entry in vertical:
        bearing = azimuth(model, entry["globalId"])
        if not bearing.decidable or bearing.value is None:
            unoriented.append({"globalId": entry["globalId"], "name": entry["name"], "area": entry["area"]})
            continue
        bucket = by_orientation.setdefault(
            bearing.value["compass"],
            {"opaque": 0.0, "transparent": 0.0, "total": 0.0, "windowWallRatio": None, "elements": []},
        )
        bucket["transparent" if entry["transparent"] else "opaque"] += entry["area"]
        bucket["elements"].append(
            {
                "globalId": entry["globalId"],
                "name": entry["name"],
                "kind": entry["kind"],
                "area": entry["area"],
                "degrees": round(float(bearing.value["degrees"]), 3),
                "transparent": entry["transparent"],
            }
        )

    for bucket in by_orientation.values():
        bucket["opaque"] = round(bucket["opaque"], 6)
        bucket["transparent"] = round(bucket["transparent"], 6)
        bucket["total"] = round(bucket["opaque"] + bucket["transparent"], 6)
        bucket["windowWallRatio"] = round(bucket["transparent"] / bucket["total"], 6) if bucket["total"] > 0 else None

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

    payload["byOrientation"] = {name: by_orientation[name] for name in COMPASS if name in by_orientation}
    payload["ohneHimmelsrichtung"] = unoriented
    return computed(
        payload,
        unit="m²",
        tolerance=abs(whole) * AREA_RELATIVE_TOLERANCE,
        from_=[e["globalId"] for e in measured],
        method=method,
        caveat=caveat,
    )


def _space_volume(model: SpatialModel, space: Any) -> float | None:
    geometry = model.geometry(space.GlobalId)
    if geometry is None or len(geometry.triangles) == 0:
        return None
    triangles = geometry.triangles
    signed = np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2]))
    return float(abs(signed.sum()) / 6.0)


def compactness(model: SpatialModel) -> Answer[dict[str, Any]]:
    method = "compactness()"
    surveyed = _survey(model)
    outside = [e for e in surveyed if e["external"] is True]
    if not outside:
        return _no_envelope(method, surveyed)

    measured = [e for e in outside if e["area"] is not None]
    without_area = [e for e in outside if e["area"] is None]
    if not measured:
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
    area = round(sum(e["area"] for e in measured), 6)

    spaces = model.file.by_type("IfcSpace")
    volumes: list[dict[str, Any]] = []
    without_body: list[Any] = []
    declared_total = 0.0
    declared_count = 0
    for space in spaces:
        volume = _space_volume(model, space)
        found = model.declared_quantity(space, ("NetVolume", "GrossVolume"))
        if volume is None:
            without_body.append(space)
            continue
        if found is not None:
            declared_total += found.value
            declared_count += 1
        volumes.append(
            {
                "globalId": space.GlobalId,
                "name": model.label(space),
                "volume": round(volume, 6),
                "declaredVolume": None if found is None else round(found.value, 6),
                "declaredAt": None if found is None else found.path,
            }
        )

    if not volumes:
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

    volume_total = round(sum(v["volume"] for v in volumes), 6)
    measured_volume = computed(
        volume_total,
        unit="m³",
        tolerance=abs(volume_total) * VOLUME_RELATIVE_TOLERANCE,
        from_=[v["globalId"] for v in volumes],
        method=f"Σ Raumkörper ({len(volumes)} IfcSpace)",
    )
    volume_answer = measured_volume
    if declared_count == len(volumes) and declared_count > 0:
        volume_answer = triangulate(
            measured_volume,
            declared(
                round(declared_total, 6),
                unit="m³",
                from_=[v["globalId"] for v in volumes],
                method=f"Σ deklarierte Raumvolumina ({declared_count} IfcSpace)",
            ),
            method=f"Σ Raumkörper ({len(volumes)} IfcSpace)",
        )
    volume = float(volume_answer.value) if volume_answer.value is not None else volume_total

    ratio = area / volume if volume > 0 else None
    if ratio is None:
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

    return computed(
        {
            "ratio": round(ratio, 6),
            "characteristicLength": round(volume / area, 6),
            "envelopeArea": area,
            "volume": round(volume, 6),
            "volumeIs": "netto (Raumkörper, bis zu den inneren Oberflächen)",
            "volumeAgreement": volume_answer.agreement,
            "areaByKind": {
                kind: round(sum(e["area"] for e in measured if e["kind"] == kind), 6)
                for kind in KIND_ORDER
                if any(e["kind"] == kind for e in measured)
            },
            "spaces": volumes,
            "elementCount": len(measured),
        },
        unit="1/m",
        tolerance=abs(ratio) * (AREA_RELATIVE_TOLERANCE + VOLUME_RELATIVE_TOLERANCE),
        from_=[e["globalId"] for e in measured] + [v["globalId"] for v in volumes],
        method=method,
        caveat=caveat,
    )


__all__ = [
    "KIND_ORDER",
    "ROUTE_BOUNDED_SPACES",
    "ROUTE_DECLARED",
    "ROUTE_UNDECIDED",
    "SLOPE_REPORT_FRACTION",
    "TRANSPARENT_TYPES",
    "VOLUME_RELATIVE_TOLERANCE",
    "compactness",
    "envelope_area_by_orientation",
    "thermal_envelope",
]
